package com.nfctuneless

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import com.nfctuneless.app.MainActivity

class HceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Porneste MainActivity daca nu e pornita
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        startActivity(intent)
        finish()
    }
}
