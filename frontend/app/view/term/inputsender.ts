// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Sends terminal input in order with at most one request in flight. The server runs each rpc in its own
// goroutine, so parallel sends could reorder keys; but waiting one round trip per key makes typing lag
// behind output, so keys typed while a send is in flight are merged into the next request.
export class InputSender {
    pending = "";
    inFlight = false;
    generation = 0;
    send: (data: string) => Promise<unknown>;

    constructor(send: (data: string) => Promise<unknown>) {
        this.send = send;
    }

    push(data: string) {
        this.pending += data;
        this.flush();
    }

    // a response lost with a dropped websocket never arrives; stop waiting for it so input keeps flowing
    reset() {
        this.generation++;
        this.inFlight = false;
        this.flush();
    }

    flush() {
        if (this.inFlight || this.pending == "") {
            return;
        }
        const data = this.pending;
        const gen = this.generation;
        this.pending = "";
        this.inFlight = true;
        this.send(data)
            .catch((e) => console.log("error sending terminal input", e))
            .finally(() => {
                if (gen != this.generation) {
                    return;
                }
                this.inFlight = false;
                this.flush();
            });
    }
}
