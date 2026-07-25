package com.okshuxue.qishua_wrongbook

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class QishuaRuntimeDiagnosticsModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    try {
      promise.resolve(
        Arguments.createMap().apply {
          putMap("hardware", buildHardwareSnapshot())
          putMap("memory", buildMemorySnapshot())
          putMap("storage", buildStorageSnapshot())
          putMap("battery", buildBatterySnapshot())
          putMap("runtime", buildRuntimeSnapshot())
        },
      )
    } catch (error: Exception) {
      promise.reject(ERROR_SNAPSHOT_FAILED, "Unable to capture runtime diagnostics.", error)
    }
  }

  private fun buildHardwareSnapshot(): WritableMap {
    val runtime = Runtime.getRuntime()
    return Arguments.createMap().apply {
      putString("deviceKind", if (isProbablyEmulator()) "emulator" else "physical")
      putString("brand", Build.BRAND)
      putString("manufacturer", Build.MANUFACTURER)
      putString("model", Build.MODEL)
      putInt("androidApiLevel", Build.VERSION.SDK_INT)
      putString("board", Build.BOARD)
      putString("hardware", Build.HARDWARE)
      putString("product", Build.PRODUCT)
      putString("device", Build.DEVICE)
      putInt("cpuCoreCount", runtime.availableProcessors())
      putArray("cpuArchitectures", Arguments.fromList(Build.SUPPORTED_ABIS.toList()))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        putString("socManufacturer", Build.SOC_MANUFACTURER)
        putString("socModel", Build.SOC_MODEL)
      }
    }
  }

  private fun buildMemorySnapshot(): WritableMap {
    val activityManager = reactContext.getSystemService(
      Context.ACTIVITY_SERVICE,
    ) as ActivityManager
    val deviceMemory = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(deviceMemory)

    val javaRuntime = Runtime.getRuntime()
    val javaHeapAllocated = javaRuntime.totalMemory()
    val javaHeapUsed = javaHeapAllocated - javaRuntime.freeMemory()
    val processMemory = activityManager.getProcessMemoryInfo(
      intArrayOf(Process.myPid()),
    ).firstOrNull()
    val deviceUsed = (deviceMemory.totalMem - deviceMemory.availMem).coerceAtLeast(0L)

    return Arguments.createMap().apply {
      putDouble("deviceTotalBytes", deviceMemory.totalMem.toDouble())
      putDouble("deviceAvailableBytes", deviceMemory.availMem.toDouble())
      putDouble("deviceUsedBytes", deviceUsed.toDouble())
      putDouble(
        "deviceAvailablePercent",
        percentage(deviceMemory.availMem, deviceMemory.totalMem),
      )
      putBoolean("lowMemory", deviceMemory.lowMemory)
      putDouble("lowMemoryThresholdBytes", deviceMemory.threshold.toDouble())
      putInt("memoryClassMb", activityManager.memoryClass)
      putInt("largeMemoryClassMb", activityManager.largeMemoryClass)
      putBoolean("lowRamDevice", activityManager.isLowRamDevice)
      putDouble("appJavaHeapUsedBytes", javaHeapUsed.toDouble())
      putDouble("appJavaHeapAllocatedBytes", javaHeapAllocated.toDouble())
      putDouble("appJavaHeapMaxBytes", javaRuntime.maxMemory().toDouble())
      putDouble("appNativeHeapAllocatedBytes", Debug.getNativeHeapAllocatedSize().toDouble())
      processMemory?.let {
        putDouble("appTotalPssBytes", it.totalPss.toDouble() * BYTES_PER_KIBIBYTE)
      }
    }
  }

  private fun buildStorageSnapshot(): WritableMap {
    val stats = StatFs(reactContext.filesDir.absolutePath)
    val total = stats.totalBytes
    val available = stats.availableBytes
    val used = (total - available).coerceAtLeast(0L)

    return Arguments.createMap().apply {
      putDouble("totalBytes", total.toDouble())
      putDouble("availableBytes", available.toDouble())
      putDouble("usedBytes", used.toDouble())
      putDouble("availablePercent", percentage(available, total))
    }
  }

  private fun buildBatterySnapshot(): WritableMap {
    val batteryIntent = reactContext.registerReceiver(
      null,
      IntentFilter(Intent.ACTION_BATTERY_CHANGED),
    )
    return Arguments.createMap().apply {
      if (batteryIntent == null) {
        putString("state", "unknown")
        putString("powerSource", "unknown")
        return@apply
      }

      val level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      if (level >= 0 && scale > 0) {
        putDouble("levelPercent", level.toDouble() * 100.0 / scale.toDouble())
      }

      putString(
        "state",
        batteryStateName(batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)),
      )
      putString(
        "powerSource",
        powerSourceName(batteryIntent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)),
      )
      putString(
        "health",
        batteryHealthName(batteryIntent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)),
      )

      val temperatureTenths = batteryIntent.getIntExtra(
        BatteryManager.EXTRA_TEMPERATURE,
        Int.MIN_VALUE,
      )
      if (temperatureTenths != Int.MIN_VALUE) {
        putDouble("temperatureCelsius", temperatureTenths.toDouble() / 10.0)
      }

      val voltage = batteryIntent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)
      if (voltage >= 0) {
        putInt("voltageMillivolts", voltage)
      }
    }
  }

  private fun buildRuntimeSnapshot(): WritableMap {
    val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    val processState = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(processState)
    val deviceUptime = SystemClock.elapsedRealtime()

    return Arguments.createMap().apply {
      putDouble("deviceUptimeMs", deviceUptime.toDouble())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        val processUptime = (
          deviceUptime - Process.getStartUptimeMillis()
        ).coerceAtLeast(0L)
        putDouble("processUptimeMs", processUptime.toDouble())
      }
      putString("processImportance", processImportanceName(processState.importance))
      putInt("lastTrimMemoryLevel", processState.lastTrimLevel)
      putBoolean("powerSaveMode", powerManager.isPowerSaveMode)
      putBoolean("interactive", powerManager.isInteractive)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        putString("thermalStatus", thermalStatusName(powerManager.currentThermalStatus))
      }
    }
  }

  private fun isProbablyEmulator(): Boolean {
    return Build.FINGERPRINT.startsWith("generic")
      || Build.FINGERPRINT.contains("emulator", ignoreCase = true)
      || Build.MODEL.contains("Emulator", ignoreCase = true)
      || Build.MODEL.contains("Android SDK built for", ignoreCase = true)
      || Build.HARDWARE.contains("goldfish", ignoreCase = true)
      || Build.HARDWARE.contains("ranchu", ignoreCase = true)
  }

  private fun percentage(part: Long, total: Long): Double {
    if (total <= 0L) {
      return 0.0
    }
    return part.toDouble() * 100.0 / total.toDouble()
  }

  private fun batteryStateName(status: Int): String = when (status) {
    BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
    BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
    BatteryManager.BATTERY_STATUS_FULL -> "full"
    BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
    else -> "unknown"
  }

  private fun powerSourceName(plugged: Int): String = when (plugged) {
    BatteryManager.BATTERY_PLUGGED_AC -> "ac"
    BatteryManager.BATTERY_PLUGGED_USB -> "usb"
    BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
    8 -> "dock"
    0 -> "unplugged"
    else -> "unknown"
  }

  private fun batteryHealthName(health: Int): String = when (health) {
    BatteryManager.BATTERY_HEALTH_GOOD -> "good"
    BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
    BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
    BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
    BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
    BatteryManager.BATTERY_HEALTH_COLD -> "cold"
    else -> "unknown"
  }

  private fun processImportanceName(importance: Int): String = when (importance) {
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "foreground"
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "foreground_service"
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible"
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE -> "service"
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
    ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE -> "gone"
    else -> "unknown_$importance"
  }

  private fun thermalStatusName(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "none"
    PowerManager.THERMAL_STATUS_LIGHT -> "light"
    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
    else -> "unknown_$status"
  }

  companion object {
    private const val MODULE_NAME = "QishuaRuntimeDiagnosticsModule"
    private const val ERROR_SNAPSHOT_FAILED = "ERR_QISHUA_RUNTIME_DIAGNOSTICS"
    private const val BYTES_PER_KIBIBYTE = 1024.0
  }
}
