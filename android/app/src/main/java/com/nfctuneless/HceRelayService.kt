package com.nfctuneless

import android.content.Context
import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK  = byteArrayOf(0x90.toByte(), 0x00.toByte())
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00.toByte())
        val responseQueue = LinkedBlockingQueue<ByteArray>(1)
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false
        var appContext: Context? = null
        var transactionCount = 0
        var successCount = 0
        val responseCache = mutableMapOf<String, ByteArray>()

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
                responseQueue.offer(SW_ERR)
            }
        }

        fun cacheResponse(apduCmd: String, apduResp: String) {
            try {
                val clean = apduResp.trim().replace(" ", "")
                if (clean.length % 2 != 0) return
                val bytes = ByteArray(clean.length / 2)
                for (i in bytes.indices) {
                    bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                }
                responseCache[apduCmd] = bytes
            } catch (e: Exception) {}
        }

        fun saveLog(msg: String) {
            try {
                val ctx = appContext ?: return
                val file = File(ctx.getExternalFilesDir(null), "hce_log.txt")
                val sdf = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault())
                FileWriter(file, true).use { it.write("${sdf.format(Date())} $msg\n") }
            } catch (e: Exception) {
                try {
                    val file = File("/sdcard/hce_log.txt")
                    FileWriter(file, true).use { it.write("LOG: $msg\n") }
                } catch (e2: Exception) {}
            }
        }

        fun sendCrashReport(msg: String) {
            try {
                Thread {
                    try {
                        val url = java.net.URL("https://ntfy.sh/nfctuneless_rxof2d45")
                        val conn = url.openConnection() as java.net.HttpURLConnection
                        conn.requestMethod = "POST"
                        conn.doOutput = true
                        conn.setRequestProperty("Title", "NFC Crash")
                        conn.setRequestProperty("Priority", "urgent")
                        conn.outputStream.write(msg.toByteArray())
                        conn.responseCode
                        conn.disconnect()
                    } catch (e: Exception) {}
                }.start()
            } catch (e: Exception) {}
        }
    }

    override fun onCreate() {
        super.onCreate()
        try {
            appContext = applicationContext
            saveLog("=== START Android ${android.os.Build.VERSION.SDK_INT} ===")
        } catch (e: Exception) {
            Log.e(TAG, "onCreate error: ${e.message}")
        }
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        // Safety - seteaza context la fiecare apel
        try { if (appContext == null) appContext = applicationContext } catch (e: Exception) {}

        if (apdu == null || apdu.isEmpty()) return SW_ERR

        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            transactionCount++
            saveLog("[$transactionCount] CMD: $apduHex active=$isActive")

            // WTX Response
            if (apdu.size >= 1 && (apdu[0].toInt() and 0xFF) == 0xF2) {
                return byteArrayOf(0xF2.toByte(), 0x01.toByte())
            }

            // Cache hit - raspuns instant
            val cached = responseCache[apduHex]
            if (cached != null &&
                !apduHex.startsWith("80AE") &&
                !apduHex.startsWith("0084")) {
                saveLog("[$transactionCount] CACHE HIT")
                return cached
            }

            // Daca HCE nu e activ - raspunde local fara crash
            if (!isActive) {
                saveLog("[$transactionCount] Inactiv - local")
                return processLocally(apduHex)
            }

            val cb = onApduReceived
            if (cb == null) {
                saveLog("[$transactionCount] Callback null - local")
                return processLocally(apduHex)
            }

            responseQueue.clear()

            // Thread separat - fix Samsung + Android 16
            Thread {
                try {
                    cb.invoke(System.currentTimeMillis().toString(), apduHex)
                } catch (e: Exception) {
                    saveLog("CB ERR: ${e.message}")
                    sendCrashReport("CB ERR: ${e.message}")
                    responseQueue.offer(SW_ERR)
                }
            }.start()

            // WTE loop - cere timp de la POS
            var resp: ByteArray? = null
            var wtxCount = 0
            val maxWtx = 8

            while (resp == null && wtxCount < maxWtx) {
                resp = responseQueue.poll(500, TimeUnit.MILLISECONDS)
                if (resp == null && wtxCount < maxWtx - 1) {
                    saveLog("WTE #${wtxCount + 1}")
                    try { sendResponseApdu(byteArrayOf(0xF2.toByte(), 0x01.toByte())) } catch (e: Exception) {}
                    wtxCount++
                }
            }

            if (resp == null) {
                saveLog("[$transactionCount] TIMEOUT dupa $wtxCount WTE")
                processLocally(apduHex)
            } else {
                successCount++
                val respHex = resp.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
                saveLog("[$transactionCount] OK: $respHex")
                resp
            }

        } catch (e: Exception) {
            val errMsg = "CRASH #$transactionCount: ${e.message}"
            saveLog(errMsg)
            sendCrashReport(errMsg)
            Log.e(TAG, errMsg, e)
            SW_ERR // Returneaza SW_ERR in loc sa crašeze
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
        } catch (e: Exception) {
            SW_ERR
        }
    }

    override fun onDeactivated(reason: Int) {
        try {
            saveLog("OFF total=$transactionCount ok=$successCount")
            responseQueue.clear()
        } catch (e: Exception) {}
    }
}
