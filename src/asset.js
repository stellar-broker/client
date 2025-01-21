import {Asset, StrKey} from '@stellar/stellar-sdk'
import errors from './errors.js'

/**
 * @param {string|Asset|{}} asset
 * @return {Asset}
 */
export function convertToStellarAsset(asset) {
    if (asset instanceof Asset)
        return asset
    if (asset === 'xlm' || asset === 'XLM' || asset.asset_type === 'native')
        return Asset.native()
    if (asset.asset_type)
        return new Asset(asset.asset_code, asset.asset_issuer)
    const [code, issuer] = asset.includes('-') ?
        asset.split('-') :
        asset.split(':')
    return new Asset(code, issuer)
}

export function parseAsset(asset, parameter) {
    if (typeof asset === 'string') {
        if (asset === 'XLM' || asset === 'xlm' || asset === 'native')
            return 'XLM'
        if (asset.includes(':')) {
            const [code, issuer] = asset.split(':')
            validateCode(code)
            validateAccount(issuer, parameter)
            return code + '-' + issuer
        }
        if (asset.includes('-')) {
            const [code, issuer] = asset.split('-')
            validateCode(code)
            validateAccount(issuer, parameter)
            return asset
        }
    }
    throw errors.invalidQuoteParam(parameter, 'Invalid asset')
}

function validateCode(code, parameter) {
    if (!/^[a-zA-Z0-9]{1,12}$/.test(code))
        throw errors.invalidQuoteParam(parameter, 'Invalid asset code: ' + (!code ? 'missing' : code))
    return code
}

function validateAccount(account, param) {
    if (!account || !StrKey.isValidEd25519PublicKey(account))
        throw errors.invalidQuoteParam(param, 'Invalid account address: ' + (!account ? 'missing' : account))
    return account
}
