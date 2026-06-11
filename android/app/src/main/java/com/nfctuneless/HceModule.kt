package com.nfctuneless

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class HceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun getName() = "HceModule"

    @ReactMethod
    fun setActive(active: Boolean) {
        HceRelayService.isActive = active

        if (active) {
            acquireWakeLock()
        } else {
            releaseWakeLock()
        }

        HceRelayService.onApduReceived = if (active) { requestId, apduHex ->
            sendEvent("onApduCommand", Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("apdu", apduHex)
            })
        } else null

        Log.d("HceModule", "HCE activ: $active")
    }

    @ReactMethod
    fun deliverResponse(requestId: String, apduHex: String) {
        HceRelayService.deliverResponse(apduHex)
        Log.d("HceModule", "Raspuns: $apduHex")
    }

    @ReactMethod
    fun acquireWakeLockJS() {
        acquireWakeLock()
    }

    @ReactMethod
    fun releaseWakeLockJS() {
        releaseWakeLock()
    }

    private fun acquireWakeLock() {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
                "NfcTuneless::HceWakeLock"
            )
            wakeLock?.acquire(10 * 60 * 1000L) // 10 minute
            Log.d("HceModule", "WakeLock achizitionat")
        } catch (e: Exception) {
            Log.e("HceModule", "WakeLock error: ${e.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let {
                if (it.isHeld) it.release()
            }
            wakeLock = null
        } catch (e: Exception) {
            Log.e("HceModule", "WakeLock release error: ${e.message}")
        }
    }

    private fun sendEvent(name: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
