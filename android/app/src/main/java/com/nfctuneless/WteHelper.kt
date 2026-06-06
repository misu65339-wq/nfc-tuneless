package com.nfctuneless

import android.util.Log

/**
 * Waiting Time Extension (WTE) Helper
 * Permite telefonului A sa ceara mai mult timp de la POS
 * in timp ce asteapta raspunsul de la Telefonul B prin relay
 */
object WteHelper {
    const val TAG = "WteHelper"

    // S-Block WTX Request - cere extensie timp de la POS
    // 0xF2 = S-Block, 0x01 = WTX cu multiplicator 1
    val WTX_REQUEST = byteArrayOf(0xF2.toByte(), 0x01.toByte())

    // Verifica daca APDU e un S-Block WTX Response de la POS
    fun isWtxResponse(apdu: ByteArray): Boolean {
        if (apdu.size < 2) return false
        return (apdu[0].toInt() and 0xFF) == 0xF2
    }

    // Verifica daca APDU e un I-Block (comanda normala)
    fun isIBlock(apdu: ByteArray): Boolean {
        if (apdu.isEmpty()) return false
        return (apdu[0].toInt() and 0xC0) == 0x00
    }

    // Construieste WTX request cu multiplicator
    fun buildWtxRequest(multiplier: Int = 1): ByteArray {
        return byteArrayOf(0xF2.toByte(), (multiplier and 0x3F).toByte())
    }

    fun log(msg: String) {
        Log.d(TAG, msg)
        HceRelayService.saveLog("WTE: $msg")
    }
}
