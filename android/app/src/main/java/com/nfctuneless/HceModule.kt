package com.nfctuneless

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class HceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null
    private val CHANNEL_ID = "nfc_tuneless_hce"
    private val NOTIF_ID = 1001

    override fun getName() = "HceModule"

    @ReactMethod
    fun setActive(active: Boolean) {
        HceRelayService.isActive = active
        if (active) {
            acquireWakeLock()
            showNotification("NFC Relay Activ", "Telefonul emulează un card NFC")
        } else {
            releaseWakeLock()
            hideNotification()
        }
        HceRelayService.onApduReceived = if (active) { requestId, apduHex ->
            sendEvent("onApduCommand", Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("apdu", apduHex)
            })
        } else null
        HceRelayService.saveLog("setActive: $active")
    }

    @ReactMethod
    fun cacheResponse(apduCmd: String, apduResp: String) {
        HceRelayService.cacheResponse(apduCmd, apduResp)
    }

    @ReactMethod
    fun deliverResponse(requestId: String, apduHex: String) {
        HceRelayService.deliverResponse(apduHex)
    }

    @ReactMethod
    fun readLog(promise: Promise) {
        try {
            val file = File(reactContext.getExternalFilesDir(null), "hce_log.txt")
            if (!file.exists()) { promise.resolve("Log gol - niciun eveniment"); return }
            val lines = file.readLines().takeLast(50).joinToString("\n")
            promise.resolve(if (lines.isEmpty()) "Log gol" else lines)
        } catch (e: Exception) {
            promise.resolve("Eroare: ${e.message}")
        }
    }

    @ReactMethod
    fun clearLog() {
        try {
            File(reactContext.getExternalFilesDir(null), "hce_log.txt").delete()
        } catch (e: Exception) {}
    }

    @ReactMethod
    fun getStats(promise: Promise) {
        val map = Arguments.createMap()
        map.putInt("total", HceRelayService.transactionCount)
        map.putInt("success", HceRelayService.successCount)
        promise.resolve(map)
    }

    private fun showNotification(title: String, text: String) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(CHANNEL_ID, "NFC Tuneless", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Status relay NFC"
                nm.createNotificationChannel(ch)
            }
            val intent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)
            val pi = PendingIntent.getActivity(reactContext, 0, intent, PendingIntent.FLAG_IMMUTABLE)
            val notif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(reactContext, CHANNEL_ID)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(reactContext)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .build()
            }
            nm.notify(NOTIF_ID, notif)
        } catch (e: Exception) {
            Log.e("HceModule", "Notification error: ${e.message}")
        }
    }

    private fun hideNotification() {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID)
        } catch (e: Exception) {}
    }

    private fun acquireWakeLock() {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "NfcTuneless::HceWakeLock"
            )
            wakeLock?.acquire(10 * 60 * 1000L)
        } catch (e: Exception) {
            Log.e("HceModule", "WakeLock error: ${e.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
        } catch (e: Exception) {}
    }

    private fun sendEvent(name: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, params)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
