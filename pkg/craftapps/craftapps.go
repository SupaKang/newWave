// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package craftapps installs and launches the ArtCraft "Crafting Apps" (https://getartcraft.com/apps),
// native desktop apps published as MSIs on github.com/storytold/<appid>.
package craftapps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const GitHubOrg = "storytold"
const DownloadTimeout = 10 * time.Minute

type craftAppDef struct {
	AppId       string
	Name        string
	Description string
	Icon        string
	Color       string
}

var craftAppDefs = []craftAppDef{
	{"photocraft", "PhotoCraft", "Image editor", "image", "#4fa3ff"},
	{"vectorcraft", "VectorCraft", "Vector illustration", "bezier-curve", "#ff9f43"},
	{"filmcraft", "FilmCraft", "Video editor", "film", "#ee5253"},
	{"lightcraft", "LightCraft", "Photo library and raw developer", "camera-retro", "#feca57"},
	{"pdfcraft", "PdfCraft", "PDF workbench", "file-pdf", "#ff6b6b"},
	{"effectcraft", "EffectCraft", "Motion graphics and VFX", "wand-magic-sparkles", "#a55eea"},
	{"designcraft", "DesignCraft", "Page layout and publishing", "newspaper", "#26de81"},
	{"figcraft", "FigCraft", "Interface design and prototyping", "pen-ruler", "#fd79a8"},
	{"wordcraft", "WordCraft", "Word processing", "file-word", "#3b82f6"},
	{"soundcraft", "SoundCraft", "Digital audio workstation", "wave-square", "#1dd1a1"},
	{"deckcraft", "DeckCraft", "Presentations and slide shows", "file-powerpoint", "#f97316"},
	{"cadcraft", "CADCraft", "Computer-aided design and drafting", "compass-drafting", "#00d2d3"},
	{"gridcraft", "GridCraft", "Spreadsheets and data analysis", "table-cells", "#22c55e"},
}

// ponytail: one global lock for all installs (msiexec refuses concurrent installs with 1618 anyway)
var installLock sync.Mutex

func findDef(appId string) (craftAppDef, bool) {
	for _, def := range craftAppDefs {
		if def.AppId == appId {
			return def, true
		}
	}
	return craftAppDef{}, false
}

func ListApps() []wshrpc.CraftAppInfo {
	rtn := make([]wshrpc.CraftAppInfo, 0, len(craftAppDefs))
	for _, def := range craftAppDefs {
		info := wshrpc.CraftAppInfo{
			AppId:       def.AppId,
			Name:        def.Name,
			Description: def.Description,
			Icon:        def.Icon,
			Color:       def.Color,
			HomeUrl:     "https://getartcraft.com/apps/" + def.AppId,
		}
		fillInstallInfo(&info)
		rtn = append(rtn, info)
	}
	return rtn
}

func Launch(appId string, filePath string) error {
	if _, ok := findDef(appId); !ok {
		return fmt.Errorf("unknown craft app: %s", appId)
	}
	info := wshrpc.CraftAppInfo{AppId: appId}
	fillInstallInfo(&info)
	if !info.Installed {
		return fmt.Errorf("%s is not installed", appId)
	}
	if filePath != "" {
		expanded, err := wavebase.ExpandHomeDir(filePath)
		if err != nil {
			return err
		}
		filePath = filepath.Clean(expanded)
	}
	return launchExe(info.ExePath, filePath)
}

// Install downloads and installs the latest MSI, then registers the app's MCP server with Claude Code / Codex.
// A failed agent registration doesn't fail the install; it is reported in the returned summary.
func Install(ctx context.Context, appId string) (string, error) {
	def, ok := findDef(appId)
	if !ok {
		return "", fmt.Errorf("unknown craft app: %s", appId)
	}
	if err := installMsi(ctx, appId); err != nil {
		return "", err
	}
	summary := def.Name + " installed."
	mcpSummary, err := RegisterMcp(ctx, appId)
	if err != nil {
		return summary + "\n" + err.Error(), nil
	}
	return summary + "\n" + mcpSummary, nil
}

func installMsi(ctx context.Context, appId string) error {
	installLock.Lock()
	defer installLock.Unlock()
	msiPath, err := downloadLatestMsi(ctx, appId)
	if err != nil {
		return err
	}
	defer os.Remove(msiPath)
	return runMsiInstall(ctx, msiPath)
}

func msiArch() string {
	switch runtime.GOARCH {
	case "arm64":
		return "arm64"
	case "386":
		return "x86"
	default:
		return "x64"
	}
}

type ghRelease struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name string `json:"name"`
		Url  string `json:"browser_download_url"`
	} `json:"assets"`
}

func downloadLatestMsi(ctx context.Context, appId string) (string, error) {
	ctx, cancelFn := context.WithTimeout(ctx, DownloadTimeout)
	defer cancelFn()
	var rel ghRelease
	apiUrl := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", GitHubOrg, appId)
	if err := getJson(ctx, apiUrl, &rel); err != nil {
		return "", fmt.Errorf("error finding latest %s release: %w", appId, err)
	}
	suffix := fmt.Sprintf("-windows-%s.msi", msiArch())
	var assetName, assetUrl string
	for _, asset := range rel.Assets {
		if strings.HasPrefix(asset.Name, appId+"-") && strings.HasSuffix(asset.Name, suffix) {
			assetName, assetUrl = asset.Name, asset.Url
			break
		}
	}
	if assetUrl == "" {
		return "", fmt.Errorf("release %s of %s has no %s installer", rel.TagName, appId, suffix)
	}
	dlDir := filepath.Join(wavebase.GetWaveCachesDir(), "craftapps")
	if err := os.MkdirAll(dlDir, 0700); err != nil {
		return "", err
	}
	msiPath := filepath.Join(dlDir, assetName)
	if err := downloadFile(ctx, assetUrl, msiPath); err != nil {
		return "", fmt.Errorf("error downloading %s: %w", assetName, err)
	}
	return msiPath, nil
}

func getJson(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func downloadFile(ctx context.Context, url string, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	tmpPath := dest + ".part"
	fd, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	_, err = io.Copy(fd, resp.Body)
	if closeErr := fd.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, dest)
}
