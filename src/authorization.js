import {Keypair} from '@stellar/stellar-sdk'
import errors from './errors.js'

export class AuthorizationWrapper {
    /**
     * @param {ClientAuthorizationParams} authorization
     */
    constructor(authorization) {
        if (typeof authorization === 'string') {
            try {
                this.authorization = Keypair.fromSecret(authorization)
                return
            } catch (e) {
                throw errors.invalidAuthorizationParam()
            }
        } else if (typeof authorization === 'function') {
            this.authorization = authorization
            return
        }
        throw errors.invalidAuthorizationParam()
    }

    /**
     * @type {Keypair|ClientAuthorizationCallback}
     * @private
     */
    authorization

    /**
     * Authorize transaction or invocation footprint hash
     * @param {TransactionI|Buffer} payload
     * @return {Promise<TransactionI|Buffer>}
     */
    async authorize(payload) {
        if (this.authorization instanceof Keypair) {
            if (payload.sign){
                payload.sign(this.authorization)
                return payload
            }
            return this.authorization.sign(payload)
        }
        return await promisify(this.authorization(payload))
    }
}

/**
 * @param {*|Promise} callResult
 * @return {Promise}
 */
function promisify(callResult) {
    if (!(callResult instanceof Promise)) {
        if (!callResult)
            return Promise.reject()
        callResult = Promise.resolve(callResult)
    }
    return callResult
}

/**
 * @typedef {function(TransactionI|Buffer):Promise<TransactionI|Buffer>} ClientAuthorizationCallback - Async authorization callback
 */

/**
 * @typedef {string|ClientAuthorizationCallback} ClientAuthorizationParams - Authorization method, either account secret key or an authorization callback
 */