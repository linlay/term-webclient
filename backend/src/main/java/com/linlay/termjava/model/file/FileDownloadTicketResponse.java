package com.linlay.termjava.model.file;

import java.time.Instant;

public record FileDownloadTicketResponse(
    String ticket,
    String downloadUrl,
    Instant expiresAt
) {
}
