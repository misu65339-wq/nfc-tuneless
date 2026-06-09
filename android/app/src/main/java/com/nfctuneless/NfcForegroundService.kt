package com.nfctuneless

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

class NfcForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "nfc_tuneless_fg"
        const val NOTIF_ID = 1002

        fun start(context: Context) {
            val intent = Intent(context, NfcForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NfcForegroundService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "NFC Tuneless Activ", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("NFC Tuneless").setContentText("Relay NFC activ")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi).setOngoing(true).build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("NFC Tuneless").setContentText("Relay NFC activ")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi).setOngoing(true).build()
        }
    }
}
