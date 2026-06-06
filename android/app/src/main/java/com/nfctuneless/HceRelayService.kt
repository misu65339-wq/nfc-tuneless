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
                Log.e(TAG, "deliverResponse error: ${e.message}")
                responseQueue.offer(SW_ERR)
            }
        }

        fun cacheResponse(apduCmd: String, apduResp: String) {
            try {
                val clean = apduResp.trim().replace(" ", "")
                val bytes = ByteArray(clean.length / 2)
                for (i in bytes.indices) {
                    bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                }
                responseCache[apduCmd] = bytes
                saveLog("Cache: ${apduCmd.take(8)}")
            } catch (e: Exception) {}
        }

        fun saveLog(msg: String) {
            try {
                val ctx = appContext ?: return
                val file = File(ctx.getExternalFilesDir(null), "hce_log.txt")
                val sdf = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault())
                FileWriter(file, true).use { it.write("${sdf.format(Date())} $msg\n") }
            } catch (e: Exception) {}
        }
    }

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        saveLog("=== START Android ${android.os.Build.VERSION.SDK_INT} ===")
    }

    override fun processCommandApdu(apdu: ByteArray?, extras: Bundle?): ByteArray {
        if (apdu == null || apdu.isEmpty()) return SW_ERR

        return try {
            val apduHex = apdu.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            transactionCount++
            saveLog("[$transactionCount] CMD: $apduHex")

            // WTX Response de la POS - ignoram
            if (WteHelper.isWtxResponse(apdu)) {
                saveLog("WTX response de la POS - ignorat")
                return WteHelper.buildWtxRequest()
            }

            // Cache hit - raspuns instant fara relay
            val cached = responseCache[apduHex]
            if (cached != null && !apduHex.startsWith("80AE") && !apduHex.startsWith("0084")) {
                saveLog("[$transactionCount] CACHE: ${apduHex.take(8)}")
                return cached
            }

            if (!isActive) return processLocally(apduHex)
            val cb = onApduReceived ?: return processLocally(apduHex)

            responseQueue.clear()

            // Trimite la JS pe thread separat
            Thread {
                try { cb.invoke(System.currentTimeMillis().toString(), apduHex) }
                catch (e: Exception) {
                    saveLog("CB ERR: ${e.message}")
                    responseQueue.offer(SW_ERR)
                }
            }.start()

            // Asteapta cu WTE - trimite extensii de timp la POS
            var resp: ByteArray? = null
            var wtxCount = 0
            val maxWtx = 8 // max 8 extensii x 500ms = 4 secunde total

            while (resp == null && wtxCount < maxWtx) {
                resp = responseQueue.poll(500, TimeUnit.MILLISECONDS)
                if (resp == null && wtxCount < maxWtx - 1) {
                    // Trimite WTE la POS ca sa nu dea timeout
                    saveLog("WTE #${wtxCount + 1} trimis la POS")
                    sendResponseApdu(WteHelper.buildWtxRequest())
                    wtxCount++
                }
            }

            if (resp == null) {
                saveLog("[$transactionCount] TIMEOUT dupa ${wtxCount} WTE")
                processLocally(apduHex)
            } else {
                successCount++
                val respHex = resp.joinToString("") { "%02X".format(it.toInt() and 0xFF) }
                saveLog("[$transactionCount] RSP: $respHex wtx=$wtxCount")
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
            apduHex.startsWith("00B2") -> SW_OK
            else -> SW_OK
        }
    }

    override fun onDeactivated(reason: Int) {
        saveLog("OFF total=$transactionCount ok=$successCount")
        try { responseQueue.clear() } catch (e: Exception) {}
    }
}
