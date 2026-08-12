import type { Express } from 'express';

export function feedbackModule(_app: Express) {
    // Feedback is served by the standalone feedback-service (Python).
    // This gateway only needs to proxy /api/v1/feedback/* if required,
    // otherwise nginx routes it directly to feedback-service.
}
