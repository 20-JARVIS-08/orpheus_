package com.orpheus.audio;

import android.Manifest;
import android.content.ContentUris;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lists every song on the phone straight from Android's MediaStore (the same index the stock
 * music players use). Nothing is copied: the web UI plays each song from its content:// URI.
 */
@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(alias = "audioNew", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "audioOld", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MediaLibraryPlugin extends Plugin {
    private ContentObserver observer;

    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "audioNew" : "audioOld";
    }

    private boolean granted() {
        return getPermissionState(alias()) == PermissionState.GRANTED;
    }

    private Uri collection() {
        return Build.VERSION.SDK_INT >= 29
            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    @Override
    public void load() {
        observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                notifyListeners("libraryChanged", new JSObject());
            }
        };
        getContext().getContentResolver()
            .registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer);
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) getContext().getContentResolver().unregisterContentObserver(observer);
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (granted()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
        } else {
            requestPermissionForAlias(alias(), call, "accessCallback");
        }
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void getTracks(final PluginCall call) {
        if (!granted()) {
            call.reject("permission");
            return;
        }
        getBridge().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri base = collection();
                    String[] proj = {
                        MediaStore.Audio.Media._ID,
                        MediaStore.Audio.Media.TITLE,
                        MediaStore.Audio.Media.ARTIST,
                        MediaStore.Audio.Media.SIZE,
                        MediaStore.Audio.Media.DATE_MODIFIED
                    };
                    JSArray out = new JSArray();
                    Cursor c = getContext().getContentResolver().query(
                        base, proj, MediaStore.Audio.Media.IS_MUSIC + " != 0", null,
                        MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC");
                    if (c != null) {
                        try {
                            while (c.moveToNext()) {
                                long id = c.getLong(0);
                                String ar = c.getString(2);
                                if (ar == null || "<unknown>".equals(ar)) ar = "";
                                JSObject o = new JSObject();
                                o.put("p", ContentUris.withAppendedId(base, id).toString());
                                o.put("ti", c.getString(1));
                                o.put("ar", ar);
                                o.put("size", c.getLong(3));
                                o.put("mt", c.getLong(4));
                                out.put(o);
                            }
                        } finally {
                            c.close();
                        }
                    }
                    JSObject r = new JSObject();
                    r.put("tracks", out);
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("scan failed: " + e.getMessage());
                }
            }
        });
    }
}
