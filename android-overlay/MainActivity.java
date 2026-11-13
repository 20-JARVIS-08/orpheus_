package com.orpheus.audio;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibraryPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            Bridge b = getBridge();
            WebView wv = b.getWebView();
            // Live room: the incoming stream must start playing without a fresh tap
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
            // AI vocal removal: let the page use several CPU threads (see IsolatedClient)
            wv.setWebViewClient(new IsolatedClient(b));
        } catch (Throwable ignored) {
            // never block the app from starting: without these two tweaks everything still works,
            // the AI vocal removal just runs on one thread
        }
    }

    /**
     * Capacitor's own WebViewClient, plus the three "cross-origin isolation" headers on every file the
     * app serves from its assets. With them the WebView exposes SharedArrayBuffer, so onnxruntime-web
     * (the AI vocal remover) can use up to 4 threads instead of 1. All app files are same-origin, so
     * nothing else is affected; the PeerJS / WebRTC connections of the live room are not either.
     */
    private static class IsolatedClient extends BridgeWebViewClient {
        IsolatedClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse r = super.shouldInterceptRequest(view, request);
            if (r != null) {
                try {
                    Map<String, String> h = new HashMap<>();
                    Map<String, String> old = r.getResponseHeaders();
                    if (old != null) h.putAll(old);
                    h.put("Cross-Origin-Opener-Policy", "same-origin");
                    h.put("Cross-Origin-Embedder-Policy", "require-corp");
                    h.put("Cross-Origin-Resource-Policy", "same-origin");
                    r.setResponseHeaders(h);
                    if (r.getMimeType() == null) r.setMimeType("application/octet-stream");
                } catch (Throwable ignored) {
                }
            }
            return r;
        }
    }
}
