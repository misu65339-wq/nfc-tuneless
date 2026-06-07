package com.nfctuneless

object WteHelper {
    fun isWtxResponse(apdu: ByteArray): Boolean {
        if (apdu.size < 1) return false
        return (apdu[0].toInt() and 0xFF) == 0xF2
    }
    fun buildWtxRequest(): ByteArray = byteArrayOf(0xF2.toByte(), 0x01.toByte())
}
