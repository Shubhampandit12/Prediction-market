import { z } from "zod";

export const CreateOrderSchema = z.object({
  marketId: z.string(),
  side: z.enum(["yes", "no"]),
  type: z.enum(["buy", "sell"]),
  price: z.number().int().min(1).max(99), // limit orders only trade between 1c and 99c
  qty: z.number().int().min(1),
});

export type Orderbook = {
  [key: string]: {
    availableQty: number;
    orders: {
      userId: string;
      qty: number;
      filledQty: number;
      originalOrderId: string;
      reverseOrder: boolean;
    }[];
  };
};

export const SplitSchema = z.object({
  marketId: z.string(),
  amount: z.number().int().min(1),
});

export const OnrampSchema = z.object({
  amount: z.number().positive(),
});

export const OfframpSchema = z.object({
  amount: z.number().positive(),
});

export const CreateMarketSchema = z.object({
  title: z.string(),
  description: z.string(),
  resolutionDescription: z.string(),
});

export const ResolveSchema = z.object({
  resolution: z.enum(["Yes", "No"]),
});
