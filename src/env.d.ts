/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Error de Ali que llevó a la página de «no disponible». */
    aliFailure?: { status: number; retryAfter?: number; code?: string }
  }
}
