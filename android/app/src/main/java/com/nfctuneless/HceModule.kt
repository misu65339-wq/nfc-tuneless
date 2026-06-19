package com.nfctuneless

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class HceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null
    private val CHANNEL_ID = "nfc_tuneless_hce"
    private val NOTIF_ID = 1001

    override fun getName() = "HceModule"

    @ReactMethod
    fun setActive(active: Boolean) {
        HceRelayService.isActive = active
        if (active) { acquireWakeLock(); showNotification(); setPreferredHceService() }
        else { unsetPreferredHceService(); releaseWakeLock(); hideNotification() }
        HceRelayService.onApduReceived = if (active) { requestId, apduHex ->
            Log.d("HceModule", "EVENT -> onApduCommand: $apduHex")
            sendEvent("onApduCommand", Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("apdu", apduHex)
            })
        } else null
        Log.d("HceModule", "setActive: $active")
    }

    @ReactMethod
    fun deliverResponse(requestId: String, apduHex: String) {
        HceRelayService.deliverResponse(apduHex)
    }

    @ReactMethod
    fun startForegroundService() {
        try { NfcForegroundService.start(reactContext) }
        catch (e: Exception) { Log.e("HceModule", "FG: ${e.message}") }
    }

    @ReactMethod
    fun stopForegroundService() {
        try { NfcForegroundService.stop(reactContext) }
        catch (e: Exception) {}
    }


    private fun setPreferredHceService() {
        try {
            val activity = currentActivity ?: return
            val adapter = NfcAdapter.getDefaultAdapter(activity) ?: return
            val ce = CardEmulation.getInstance(adapter)
            val component = ComponentName("com.nfctuneless.app", "com.nfctuneless.HceRelayService")
            ce.setPreferredService(activity, component)
            Log.d("HceModule", "Preferred HCE service set")
        } catch (e: Exception) {
            Log.e("HceModule", "setPreferredHceService: ${e.message}")
        }
    }

    private fun unsetPreferredHceService() {
        try {
            val activity = currentActivity ?: return
            val adapter = NfcAdapter.getDefaultAdapter(activity) ?: return
            val ce = CardEmulation.getInstance(adapter)
            ce.unsetPreferredService(activity)
            Log.d("HceModule", "Preferred HCE service unset")
        } catch (e: Exception) {
            Log.e("HceModule", "unsetPreferredHceService: ${e.message}")
        }
    }

    private fun showNotification() {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "NFC Tuneless", NotificationManager.IMPORTANCE_LOW))
            }
            val pi = PendingIntent.getActivity(reactContext, 0,
                reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName),
                PendingIntent.FLAG_IMMUTABLE)
            val notif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(reactContext, CHANNEL_ID)
                    .setContentTitle("NFC Tuneless").setContentText("Relay activ")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentIntent(pi).setOngoing(true).build()
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(reactContext)
                    .setContentTitle("NFC Tuneless").setContentText("Relay activ")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentIntent(pi).setOngoing(true).build()
            }
            nm.notify(NOTIF_ID, notif)
        } catch (e: Exception) {}
    }

    private fun hideNotification() {
        try {
            (reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF_ID)
        } catch (e: Exception) {}
    }

    private fun acquireWakeLock() {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "NfcTuneless::WakeLock")
            wakeLock?.acquire(10 * 60 * 1000L)
        } catch (e: Exception) {}
    }

    private fun releaseWakeLock() {
        try { wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null }
        catch (e: Exception) {}
    }

    private fun sendEvent(name: String, params: WritableMap) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
