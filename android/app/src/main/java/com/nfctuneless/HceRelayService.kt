package com.nfctuneless

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK   = byteArrayOf(0x90.toByte(), 0x00.toByte())
        val SW_ERR  = byteArrayOf(0x6F.toByte(), 0x00.toByte())

        val responseQueue = LinkedBlockingQueue<ByteArray>(1)
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false

        fun deliverResponse(apduHex: String) {
            try {
                if (apduHex.isEmpty()) { responseQueue.offer(SW_ERR); return }
                val clean = apduHex.trim().replace(" ", "")
                if (clean.length % 2 != 0) { responseQueue.offer(SW_ERR); return }
                val bytes = ByteArray(clean.length / 2)
                for (i in bytes.indices) {
                    bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                }
                responseQueue.offer(bytes)
            } catch (e: Exception) {
                Log.e(TAG, "deliverResponse error: ${e.message}")
                responseQueue.offer(SW_ERR)
            }
        }
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        if (apdu == null || apdu.isEmpty()) return SW_ERR
        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            Log.d(TAG, "APDU: $apduHex active=$isActive")

            if (!isActive) return processLocally(apduHex)

            val cb = onApduReceived ?: return processLocally(apduHex)

            responseQueue.clear()

            Handler(Looper.getMainLooper()).post {
                try { cb.invoke(System.currentTimeMillis().toString(), apduHex) }
                catch (e: Exception) { Log.e(TAG, "callback error: ${e.message}"); responseQueue.offer(SW_ERR) }
            }

            responseQueue.poll(4500, TimeUnit.MILLISECONDS) ?: processLocally(apduHex)

        } catch (e: Exception) {
            Log.e(TAG, "processCommandApdu crash: ${e.message}")
            SW_ERR
        }
    }

    private fun processLocally(apduHex: String): ByteArray {
        return try {
            when {
                apduHex.startsWith("00A40400") -> byteArrayOf(
                    0x6F, 0x0A, 0x84.toByte(), 0x06,
                    0x4E, 0x46, 0x43, 0x54, 0x55, 0x4C,
                    0x90.toByte(), 0x00
                )
                apduHex.startsWith("80A800") -> byteArrayOf(0x77, 0x00, 0x90.toByte(), 0x00)
                else -> SW_OK
            }
        } catch (e: Exception) { SW_ERR }
    }

    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "onDeactivated: $reason")
        try { responseQueue.clear() } catch (e: Exception) {}
    }
}
