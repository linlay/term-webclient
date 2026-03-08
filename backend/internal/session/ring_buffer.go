package session

import "sync"

type OutputChunk struct {
	Seq  int64
	Data []byte
}

type Snapshot struct {
	RequestedAfterSeq int64
	FirstAvailableSeq int64
	LatestSeq         int64
	Truncated         bool
	Chunks            []OutputChunk
}

type RingBuffer struct {
	mu         sync.Mutex
	maxBytes   int
	maxChunks  int
	chunks     []OutputChunk
	totalBytes int
	latestSeq  int64
}

func NewRingBuffer(maxBytes, maxChunks int) *RingBuffer {
	if maxBytes <= 0 {
		maxBytes = 1
	}
	if maxChunks <= 0 {
		maxChunks = 1
	}
	return &RingBuffer{
		maxBytes:  maxBytes,
		maxChunks: maxChunks,
		chunks:    make([]OutputChunk, 0, maxChunks),
	}
}

func (b *RingBuffer) Append(seq int64, data []byte) {
	if len(data) == 0 {
		return
	}
	copyData := append([]byte(nil), data...)
	b.mu.Lock()
	defer b.mu.Unlock()

	b.chunks = append(b.chunks, OutputChunk{Seq: seq, Data: copyData})
	b.totalBytes += len(copyData)
	if seq > b.latestSeq {
		b.latestSeq = seq
	}
	b.trim()
}

func (b *RingBuffer) SnapshotAfter(afterSeq int64) Snapshot {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.chunks) == 0 {
		return Snapshot{
			RequestedAfterSeq: afterSeq,
			FirstAvailableSeq: afterSeq + 1,
			LatestSeq:         b.latestSeq,
			Chunks:            []OutputChunk{},
		}
	}

	firstAvailable := b.chunks[0].Seq
	result := make([]OutputChunk, 0, len(b.chunks))
	for _, chunk := range b.chunks {
		if chunk.Seq > afterSeq {
			result = append(result, OutputChunk{
				Seq:  chunk.Seq,
				Data: append([]byte(nil), chunk.Data...),
			})
		}
	}

	return Snapshot{
		RequestedAfterSeq: afterSeq,
		FirstAvailableSeq: firstAvailable,
		LatestSeq:         b.latestSeq,
		Truncated:         afterSeq < (firstAvailable - 1),
		Chunks:            result,
	}
}

func (b *RingBuffer) LatestSeq() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.latestSeq
}

func (b *RingBuffer) trim() {
	for len(b.chunks) > 0 && (len(b.chunks) > b.maxChunks || b.totalBytes > b.maxBytes) {
		removed := b.chunks[0]
		b.chunks = b.chunks[1:]
		b.totalBytes -= len(removed.Data)
	}
}
