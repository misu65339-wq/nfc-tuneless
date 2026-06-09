package com.nfctuneless

import android.app.Application
import android.content.Context
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK  = byteArrayOf(0x90.toByte(), 0x00.toByte())
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00.toByte())

        @Volatile var isActive = false
        @Volatile var appContext: Context? = null
        var onApduReceived: ((String, String) -> Unit)? = null

        val responseLock = java.util.concurrent.locks.ReentrantLock()
        val responseCondition = responseLock.newCondition()
        @Volatile var pendingResponse: ByteArray? = null

        fun deliverResponse(apduHex: String) {
            responseLock.lock()
            try {
                pendingResponse = try {
                    val clean = apduHex.trim().replace(" ", "")
                    if (clean.isEmpty() || clean.length % 2 != 0) SW_ERR
                    else ByteArray(clean.length / 2) { i ->
                        clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                    }
                } catch (e: Exception) { SW_ERR }
                responseCondition.signalAll()
            } finally {
                responseLock.unlock()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        try { appContext = applicationContext } catch (e: Exception) {}
        Log.d(TAG, "onCreate")
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        // Seteaza context la fiecare apel - safety
        try { if (appContext == null) appContext = applicationContext } catch (e: Exception) {}

        // Nu crasa niciodata - returneaza intotdeauna un raspuns valid
        if (apdu == null || apdu.isEmpty()) return SW_ERR

        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            Log.d(TAG, "APDU: $apduHex active=$isActive")

            // Daca nu e activ - raspunde local imediat fara crash
            if (!isActive) return processLocally(apduHex)

            val cb = onApduReceived ?: return processLocally(apduHex)

            responseLock.lock()
            try {
                pendingResponse = null

                // Invocare callback
                try { cb.invoke(System.currentTimeMillis().toString(), apduHex) }
                catch (e: Exception) {
                    Log.e(TAG, "CB error: ${e.message}")
                    return processLocally(apduHex)
                }

                // Asteapta raspuns max 3 secunde
                val deadline = System.currentTimeMillis() + 3000
                while (pendingResponse == null) {
                    val remaining = deadline - System.currentTimeMillis()
                    if (remaining <= 0) break
                    responseCondition.await(remaining, java.util.concurrent.TimeUnit.MILLISECONDS)
                }

                pendingResponse ?: processLocally(apduHex)
            } finally {
                responseLock.unlock()
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error: ${e.message}")
            SW_ERR // NICIODATA nu crasa
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
                apduHex.startsWith("00B2") -> SW_OK
                else -> SW_OK
            }
        } catch (e: Exception) { SW_ERR }
    }

    override fun onDeactivated(reason: Int) {
        try {
            responseLock.lock()
            try {
                pendingResponse = SW_ERR
                responseCondition.signalAll()
            } finally {
                responseLock.unlock()
            }
        } catch (e: Exception) {}
    }
}
