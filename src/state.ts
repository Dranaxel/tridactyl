/**
 * Tridactyl shared state
 *
 * __NB__: Here be dragons.
 *
 * In the background script, "state" can be used as a normal object. Just "import state from "@src/state"
 *
 * In the content scripts, "state" can be set as a normal object and changes will propagate to the background script.
 *
 * In the content scripts, "state" must be read using "import * as State from "@src/state" and "State.getAsync(property)". If you read it directly with `state` you should get an error at runtime. Certain methods like `concat` will not throw an error but their behaviour is not defined and should be avoided.
 */

import Logger from "@src/lib/logging"
import * as messaging from "@src/lib/messaging"
import {notBackground} from "@src/lib/webext"

const logger = new Logger("state")

class State {
    lastSearchQuery: string = undefined
    cmdHistory: string[] = []
    prevInputs: Array<{ inputId: string; tab: number; jumppos?: number }> = [
        {
            inputId: undefined,
            tab: undefined,
            jumppos: undefined,
        },
    ]
    last_ex_str: string = "echo"
}

// Don't change these from const or you risk breaking the Proxy below.
const defaults = Object.freeze(new State())

const overlay = {} as State
browser.storage.local
    .get("state")
    .then(res => {
        if ("state" in res) {
            logger.debug("Loaded initial state:", res.state)
            Object.assign(overlay, res.state)
        }
    })
    .catch((...args) => logger.error(...args))

const state = (new Proxy(overlay, {
    /** Give defaults if overlay doesn't have the key */
    get(target, property) {
        if (notBackground()) throw "State object must be accessed with getAsync in content"
        if (property in target) {
            return target[property]
        } else {
            return defaults[property]
        }
    },

    /** Persist sets to storage "immediately" */
    set(target, property, value) {
        // Ensure we don't accidentally store anything sensitive
        if (browser.extension.inIncognitoContext) return false

        logger.debug("State changed!", property, value)
        if (notBackground()) {
            browser.runtime.sendMessage({type: "state", command: "stateUpdate", args: {property, value}})
            return true
        }
        // Do we need a global storage lock?
        target[property] = value
        browser.storage.local.set({ state: target } as any)
        return true
    },
}))

export async function getAsync(property) {
    if (notBackground()) return browser.runtime.sendMessage({type: "state", command: "stateGet", args: [{prop: property}]})
    else return state[property]
}

// Keep instances of state.ts synchronised with each other
messaging.addListener("state", (message, sender, sendResponse) => {
    if (message.command == "stateUpdate") {
        const property = message.args.property
        const value = message.args.value
        logger.debug("State changed!", property, value)
        overlay[property] = value
    } else if (message.command == "stateGet") {
        sendResponse(state[message.args[0].prop])
    } else throw("Unsupported message to state, type " + message.command)
})

export { state as default }
