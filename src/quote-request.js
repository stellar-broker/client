import {StrKey} from '@stellar/stellar-sdk'
import errors from './errors.js'
import {parseAsset} from './asset.js'

/**
 * @typedef {object} SwapQuoteParams
 * @property {string} sellingAsset - Asset to sell
 * @property {string} buyingAsset - Asset to buy
 * @property {string} [sellingAmount] - Amount of selling asset
 * @property {string} [buyingAmount] - Amount of buying asset
 * @property {number} [slippageTolerance] - Swap slippage tolerance (0.02 by default - 2%)
 * @property {string} [destination] - Trader account address
 */

/**
 * @param {SwapQuoteParams} params
 * @return {SwapQuoteParams}
 */
export function validateQuoteRequest(params) {
    const {
        destination, sellingAsset, selling_asset, buyingAsset, buying_asset, sellingAmount, selling_amount,
        buyingAmount, buying_amount, slippageTolerance, slippage_tolerance, ...other
    } = params
    const res = {
        sellingAsset: parseAsset(sellingAsset || selling_asset, 'sellingAsset'),
        buyingAsset: parseAsset(buyingAsset || buying_asset, 'buyingAsset'),
        sellingAmount: parseAmount(sellingAmount || selling_amount, 'sellingAmount'),
        buyingAmount: parseAmount(buyingAmount || buying_amount, 'buyingAmount'),
        slippageTolerance: parseSlippageTolerance(slippageTolerance || slippage_tolerance || 0.02, 'slippageTolerance')
    }
    if (res.buyingAsset === res.sellingAsset)
        throw errors.invalidQuoteParam('buyingAsset', 'Buying asset can\'t be the same as selling asset')
    if (res.buyingAmount === undefined && res.sellingAmount === undefined)
        throw errors.invalidQuoteParam('sellingAmount', 'Either "buyingAmount" or "sellingAmount" parameter is required')
    if (res.buyingAmount !== undefined && res.sellingAmount !== undefined)
        throw errors.invalidQuoteParam('sellingAmount', 'Parameters "buyingAmount" and "sellingAmount" are mutually exclusive')
    Object.assign(res, other) //add remaining optional params
    Object.freeze(res)
    return res
}

function parseAmount(amount, parameter) {
    if (amount === undefined)
        return undefined
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0)
        throw errors.invalidQuoteParam(parameter, 'Invalid asset amount: ' + amount)
    return amount
}

function parseSlippageTolerance(src, parameter) {
    const tolerance = parseFloat(src)
    if (isNaN(tolerance))
        throw errors.invalidQuoteParam(parameter, 'Invalid slippage tolerance, number expected')
    if (tolerance < 0)
        throw errors.invalidQuoteParam(parameter, 'Slippage tolerance is too small, expected value >= 0')
    if (tolerance > 0.5)
        throw errors.invalidQuoteParam(parameter, 'Slippage tolerance is too large, expected value < 0.5 (50%)')
    return tolerance
}