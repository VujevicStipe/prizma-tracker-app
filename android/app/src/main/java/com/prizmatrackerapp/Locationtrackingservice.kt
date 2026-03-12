package com.prizmatrackerapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class LocationTrackingService : Service() {
    
    companion object {
        private const val TAG = "LocationService"
        private const val CHANNEL_ID = "PrizmaTrackerChannel"
        private const val NOTIFICATION_ID = 12345
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val EXTRA_WORKER_NAME = "workerName"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "✅ Service onCreate()")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "📱 onStartCommand - action: ${intent?.action}")
        
        try {
            intent?.let {
                when (it.action) {
                    ACTION_START -> {
                        val workerName = it.getStringExtra(EXTRA_WORKER_NAME) ?: "Radnik"
                        Log.d(TAG, "🚀 Starting service for: $workerName")
                        startForegroundService(workerName)
                    }
                    ACTION_STOP -> {
                        Log.d(TAG, "🛑 Stopping service")
                        stopForegroundService()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in onStartCommand", e)
        }
        
        return START_STICKY
    }

    private fun startForegroundService(workerName: String) {
        try {
            Log.d(TAG, "🔔 Creating notification...")
            val notification = createNotification(workerName)
            
            // Mora se pozvati unutar 5 sekundi!
            startForeground(NOTIFICATION_ID, notification)
            Log.d(TAG, "✅ Notification displayed!")
            
        } catch (e: SecurityException) {
            Log.e(TAG, "❌ SecurityException - POST_NOTIFICATIONS permission missing!", e)
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error starting foreground", e)
        }
    }

    private fun stopForegroundService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_DETACH)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            Log.d(TAG, "✅ Service stopped")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error stopping service", e)
        }
    }

    private fun createNotification(workerName: String): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("📍 Prizma Tracker")
            .setContentText("Tracking aktivan - $workerName")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation) // Fallback icon
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                }
            }
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Log.d(TAG, "📢 Creating notification channel...")
                
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Prizma Tracker",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "GPS Tracking u pozadini"
                    setShowBadge(true)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    enableLights(false)
                    enableVibration(false)
                }
                
                val manager = getSystemService(NotificationManager::class.java)
                manager?.createNotificationChannel(channel)
                
                Log.d(TAG, "✅ Notification channel created")
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error creating channel", e)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "🔴 Service destroyed")
    }
}