package com.imperialmcterminal

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.imperialmcterminal.atol.AtolPackage
import com.imperialmcterminal.updates.UpdateModule
import com.imperialmcterminal.updates.UpdatePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    // В debug всегда Metro. В release — OTA-бандл, если он есть и совместим с APK.
    val otaBundle =
      if (BuildConfig.DEBUG) null else UpdateModule.resolveJsBundlePath(applicationContext)

    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(AtolPackage())
          add(UpdatePackage())
        },
      jsBundleFilePath = otaBundle,
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
