declare global {
  namespace Express {
    interface Request {
      user?: DecodedToken;
    }
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface DecodedToken {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}
