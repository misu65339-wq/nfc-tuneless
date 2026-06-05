package com.nfctuneless

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00)
        val responseQueue = LinkedBlockingQueue<ByteArray>(1)
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false

        fun deliverResponse(apduHex: String) {
            val bytes = apduHex.chunked(2)
                .map { it.toInt(16).toByte() }
                .toByteArray()
            responseQueue.offer(bytes)
        }
    }

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        val apduHex = apdu.joinToString("") { "%02X".format(it) }
        Log.d(TAG, "APDU POS: $apduHex")
        if (!isActive || onApduReceived == null) return SW_ERR
        val requestId = System.currentTimeMillis().toString()
        responseQueue.clear()
        onApduReceived?.invoke(requestId, apduHex)
        return responseQueue.poll(4500, TimeUnit.MILLISECONDS) ?: SW_ERR
    }

    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "Dezactivat: $reason")
        responseQueue.clear()
    }
}
