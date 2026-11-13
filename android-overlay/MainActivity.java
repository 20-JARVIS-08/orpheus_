package com.orpheus.audio;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibraryPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            // Live room: the incoming stream must start playing without a fresh tap
            WebView wv = getBridge().getWebView();
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
        } catch (Throwable ignored) {
        }
    }
}
