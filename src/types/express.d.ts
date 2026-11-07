// Augment Express's Request type globally so req.user is available on all
// routes after the requireAuth middleware has populated it.
declare namespace Express {
  interface Request {
    user: {
      id: string;
      email: string;
    };
  }
}
