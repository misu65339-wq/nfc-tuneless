package com.nfctuneless

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec

class DataLogModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName() = "DataLogModule"

    private val lock = Any()
    private val prefs = ctx.getSharedPreferences("datalog_auth", Context.MODE_PRIVATE)
    private val file = File(ctx.filesDir, "datalog_v1.enc")
    private val alias = "nfctuneless_datalog_v1"
    @Volatile private var unlocked = false

    private fun b64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun un64(value: String): ByteArray =
        Base64.decode(value, Base64.NO_WRAP)

    private fun derive(password: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, 210000, 256)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        val existing = store.getKey(alias, null)
        if (existing is SecretKey) return existing

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return cipher.iv + cipher.doFinal(plain)
    }

    private fun decrypt(data: ByteArray): ByteArray {
        require(data.size > 28) { "Invalid encrypted file" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, data.copyOfRange(0, 12))
        )
        return cipher.doFinal(data.copyOfRange(12, data.size))
    }

    private fun readRows(): JSONArray {
        if (!file.exists()) return JSONArray()
        return JSONArray(String(decrypt(file.readBytes()), Charsets.UTF_8))
    }

    private fun writeRows(rows: JSONArray) {
        val encrypted = encrypt(rows.toString().toByteArray(Charsets.UTF_8))
        val tmp = File(ctx.filesDir, "datalog_v1.tmp")
        tmp.writeBytes(encrypted)
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw IllegalStateException("Nu s-a putut salva jurnalul")
        }
    }

    @ReactMethod
    fun isConfigured(promise: Promise) {
        promise.resolve(prefs.contains("hash"))
    }

    @ReactMethod
    fun setup(password: String, promise: Promise) {
        synchronized(lock) {
            try {
                require(!prefs.contains("hash")) { "Parola este deja configurată" }
                require(password.length >= 8) { "Parola trebuie să aibă minimum 8 caractere" }

                val salt = ByteArray(16)
                SecureRandom().nextBytes(salt)
                val hash = derive(password, salt)

                key()
                writeRows(JSONArray())

                prefs.edit()
                    .putString("salt", b64(salt))
                    .putString("hash", b64(hash))
                    .commit()

                unlocked = true
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SETUP_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun unlock(password: String, promise: Promise) {
        synchronized(lock) {
            try {
                val salt = prefs.getString("salt", null)
                    ?: throw IllegalStateException("DATA LOG nu este configurat")
                val expected = prefs.getString("hash", null)
                    ?: throw IllegalStateException("DATA LOG nu este configurat")

                val actual = derive(password, un64(salt))
                val correct = MessageDigest.isEqual(actual, un64(expected))
                actual.fill(0)

                if (!correct) {
                    unlocked = false
                    promise.resolve(false)
                    return
                }

                readRows()
                unlocked = true
                promise.resolve(true)
            } catch (e: Exception) {
                unlocked = false
                promise.reject("UNLOCK_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun lockLog(promise: Promise) {
        unlocked = false
        promise.resolve(true)
    }

    @ReactMethod
    fun appendEvent(
        session: String,
        role: String,
        event: String,
        promise: Promise
    ) {
        synchronized(lock) {
            try {
                if (!prefs.contains("hash")) {
                    promise.resolve(false)
                    return
                }

                // Evenimente tehnice, fără APDU sau identificatori de card.
                val allowed = setOf(
                    "CONNECTION", "DISCONNECTION", "NFC",
                    "RELAY_REQUEST", "RELAY_RESPONSE",
                    "ERROR", "STATUS", "SESSION"
                )

                require(event in allowed) { "Eveniment nepermis" }

                val row = JSONObject()
                    .put("timestamp", System.currentTimeMillis())
                    .put("session", session.take(80))
                    .put("role", if (role == "B") "B" else "A")
                    .put("event", event)

                val rows = readRows()
                rows.put(row)
                writeRows(rows)

                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("APPEND_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun listEvents(promise: Promise) {
        synchronized(lock) {
            try {
                require(unlocked) { "DATA LOG este blocat" }
                promise.resolve(readRows().toString())
            } catch (e: Exception) {
                promise.reject("READ_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun deleteAll(promise: Promise) {
        synchronized(lock) {
            try {
                require(unlocked) { "DATA LOG este blocat" }
                writeRows(JSONArray())
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("DELETE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun copyText(value: String, promise: Promise) {
        try {
            require(unlocked) { "DATA LOG este blocat" }
            val clipboard = ctx.getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("DATA LOG", value))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("COPY_ERROR", e.message, e)
        }
    }
}
