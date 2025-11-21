import type { Request, Response, NextFunction } from "express";

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userRole = req.user.role;

  if (userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
};
