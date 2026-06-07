package com.nfctuneless

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

        // Callback simplu - fara queue, fara thread
        var onApduReceived: ((String, String) -> Unit)? = null

        // Response queue thread-safe
        val responseLock = java.util.concurrent.locks.ReentrantLock()
        val responseCondition = responseLock.newCondition()
        var pendingResponse: ByteArray? = null

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
        appContext = applicationContext
        Log.d(TAG, "HCE Service creat")
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        // NICIODATA nu arunca exceptie din aceasta functie
        return try {
            if (apdu == null || apdu.isEmpty()) return SW_ERR

            val apduHex = try {
                apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            } catch (e: Exception) { return SW_ERR }

            Log.d(TAG, "APDU: $apduHex active=$isActive")

            // Daca nu e activ - raspunde local imediat
            if (!isActive) return processLocally(apduHex)

            // Daca nu avem callback - raspunde local
            val cb = onApduReceived ?: return processLocally(apduHex)

            // Trimite la JS
            responseLock.lock()
            try {
                pendingResponse = null

                // Invocare callback pe thread curent - mai sigur pe Samsung
                try {
                    cb.invoke(System.currentTimeMillis().toString(), apduHex)
                } catch (e: Exception) {
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
            // NICIODATA nu crasa - returneaza SW_ERR
            Log.e(TAG, "processCommandApdu error: ${e.message}")
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
                apduHex.startsWith("80A800") -> byteArrayOf(
                    0x77, 0x00, 0x90.toByte(), 0x00
                )
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
            Log.d(TAG, "Dezactivat: $reason")
        } catch (e: Exception) {}
    }
}
