package com.linlay.termjava.model.file;

public enum FileDownloadTicketMode {
    SINGLE,
    ARCHIVE;

    public static FileDownloadTicketMode fromValue(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("mode is required");
        }
        for (FileDownloadTicketMode item : values()) {
            if (item.name().equalsIgnoreCase(raw.trim())) {
                return item;
            }
        }
        throw new IllegalArgumentException("unsupported mode: " + raw);
    }
}
