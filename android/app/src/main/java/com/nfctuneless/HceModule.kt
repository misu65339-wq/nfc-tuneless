package com.nfctuneless

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class HceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "HceModule"

    @ReactMethod
    fun setActive(active: Boolean) {
        HceRelayService.isActive = active
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
        Log.d("HceModule", "Raspuns livrat: $apduHex")
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
