package com.nfctuneless

import android.content.Context
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK  = byteArrayOf(0x90.toByte(), 0x00.toByte())
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00.toByte())
        val responseQueue = LinkedBlockingQueue<ByteArray>(1)
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false
        var appContext: Context? = null

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

        fun saveLog(msg: String) {
            try {
                val ctx = appContext ?: return
                val file = File(ctx.getExternalFilesDir(null), "hce_log.txt")
                val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                FileWriter(file, true).use { it.write("${sdf.format(Date())} $msg\n") }
            } catch (e: Exception) {}
        }
    }

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        saveLog("Service creat - Android ${android.os.Build.VERSION.SDK_INT}")
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        if (apdu == null || apdu.isEmpty()) return SW_ERR
        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            saveLog("APDU: $apduHex active=$isActive")

            if (!isActive) return processLocally(apduHex)

            val cb = onApduReceived ?: return processLocally(apduHex)

            responseQueue.clear()

            // Folosim thread separat in loc de MainLooper - fix pentru Android 16
            Thread {
                try {
                    cb.invoke(System.currentTimeMillis().toString(), apduHex)
                    saveLog("Callback OK")
                } catch (e: Exception) {
                    saveLog("Callback ERROR: ${e.message}")
                    responseQueue.offer(SW_ERR)
                }
            }.start()

            val resp = responseQueue.poll(4500, TimeUnit.MILLISECONDS)
            if (resp == null) {
                saveLog("TIMEOUT - local fallback")
                processLocally(apduHex)
            } else {
                val respHex = resp.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
                saveLog("Raspuns: $respHex")
                resp
            }

        } catch (e: Exception) {
            saveLog("CRASH: ${e.message}")
            SW_ERR
        }
    }

    private fun processLocally(apduHex: String): ByteArray {
        return when {
            apduHex.startsWith("00A40400") -> byteArrayOf(
                0x6F, 0x0A, 0x84.toByte(), 0x06,
                0x4E, 0x46, 0x43, 0x54, 0x55, 0x4C,
                0x90.toByte(), 0x00
            )
            apduHex.startsWith("80A800") -> byteArrayOf(0x77, 0x00, 0x90.toByte(), 0x00)
            else -> SW_OK
        }
    }

    override fun onDeactivated(reason: Int) {
        saveLog("Dezactivat: $reason")
        try { responseQueue.clear() } catch (e: Exception) {}
    }
}
