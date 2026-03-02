import { Request, Response, NextFunction } from 'express';

export function authenticateMailerRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.headers['x-mailer-token'] as string;
  const expectedToken = process.env.MAILER_AUTH_TOKEN;

  if (!expectedToken) {
    console.error('MAILER_AUTH_TOKEN is not set in environment variables');
    res.status(500).json({ success: false, message: 'Server configuration error' });
    return;
  }

  if (!token || token !== expectedToken) {
    res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
    return;
  }

  next();
}
