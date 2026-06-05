package com.nfctuneless

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK  = byteArrayOf(0x90.toByte(), 0x00)
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00)
        val SW_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())

        val responseQueue = LinkedBlockingQueue<ByteArray>(1)
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false

        fun deliverResponse(apduHex: String) {
            try {
                val clean = apduHex.replace("\\s".toRegex(), "")
                val bytes = clean.chunked(2)
                    .map { it.toInt(16).toByte() }
                    .toByteArray()
                responseQueue.offer(bytes)
            } catch (e: Exception) {
                Log.e(TAG, "deliverResponse error: ${e.message}")
                responseQueue.offer(SW_ERR)
            }
        }
    }

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it) }
            Log.d(TAG, "APDU POS: $apduHex isActive=$isActive")

            if (!isActive) {
                Log.d(TAG, "HCE inactiv - raspuns local")
                return processLocally(apduHex)
            }

            val callback = onApduReceived
            if (callback == null) {
                Log.d(TAG, "Callback null - raspuns local")
                return processLocally(apduHex)
            }

            val requestId = System.currentTimeMillis().toString()
            responseQueue.clear()
            callback.invoke(requestId, apduHex)

            val response = responseQueue.poll(4500, TimeUnit.MILLISECONDS)
            if (response == null) {
                Log.w(TAG, "Timeout - raspuns local")
                processLocally(apduHex)
            } else {
                Log.d(TAG, "Raspuns relay: ${response.joinToString("") { "%02X".format(it) }}")
                response
            }
        } catch (e: Exception) {
            Log.e(TAG, "processCommandApdu error: ${e.message}")
            SW_ERR
        }
    }

    private fun processLocally(apduHex: String): ByteArray {
        return when {
            apduHex.startsWith("00A40400") -> {
                // SELECT AID - raspunde cu FCI
                byteArrayOf(
                    0x6F, 0x0A,
                    0x84.toByte(), 0x06,
                    0x4E, 0x46, 0x43, 0x54, 0x55, 0x4C
                ) + SW_OK
            }
            apduHex.startsWith("80A800") -> {
                // GPO
                byteArrayOf(0x77, 0x00) + SW_OK
            }
            else -> SW_OK
        }
    }

    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "Dezactivat: $reason")
        responseQueue.clear()
    }
}
