package com.linlay.termjava.model.file;

public enum UploadConflictPolicy {
    OVERWRITE,
    RENAME,
    REJECT;

    public static UploadConflictPolicy fromValue(String value) {
        if (value == null || value.isBlank()) {
            return RENAME;
        }
        for (UploadConflictPolicy item : values()) {
            if (item.name().equalsIgnoreCase(value.trim())) {
                return item;
            }
        }
        throw new IllegalArgumentException("unsupported conflictPolicy: " + value);
    }
}
