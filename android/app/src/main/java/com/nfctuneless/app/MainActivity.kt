package com.nfctuneless.app

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private var cardEmulation: CardEmulation? = null
    private var pendingIntent: PendingIntent? = null
    private val hceComponent = ComponentName(
        "com.nfctuneless.app",
        "com.nfctuneless.HceRelayService"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        // Ecran mereu pornit + vizibil peste lockscreen
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )

        setTheme(R.style.AppTheme)
        super.onCreate(null)

        try {
            nfcAdapter = NfcAdapter.getDefaultAdapter(this)
            cardEmulation = CardEmulation.getInstance(nfcAdapter ?: return)
        } catch (e: Exception) {}

        val intent = Intent(this, javaClass).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    override fun onResume() {
        super.onResume()
        try {
            // setPreferredService - preia NFC inaintea Google Pay
            cardEmulation?.setPreferredService(this, hceComponent)
            // enableForegroundDispatch - preia toate evenimentele NFC
            nfcAdapter?.enableForegroundDispatch(this, pendingIntent, null, null)
        } catch (e: Exception) {}
    }

    override fun onPause() {
        super.onPause()
        try {
            cardEmulation?.unsetPreferredService(this)
            nfcAdapter?.disableForegroundDispatch(this)
        } catch (e: Exception) {}
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Mentine activitatea in foreground cand primeste NFC intent
        try {
            intent?.let {
                if (it.action == NfcAdapter.ACTION_TAG_DISCOVERED ||
                    it.action == NfcAdapter.ACTION_TECH_DISCOVERED) {
                    // Nu face nimic - HCE service se ocupa
                }
            }
        } catch (e: Exception) {}
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled
            ) {}
        )
    }

    override fun invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (!moveTaskToBack(false)) {
                super.invokeDefaultOnBackPressed()
            }
            return
        }
        super.invokeDefaultOnBackPressed()
    }
}
