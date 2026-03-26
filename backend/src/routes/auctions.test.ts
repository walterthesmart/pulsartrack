import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import pool from '../config/database';
import { generateTestToken } from '../test-utils';

describe('Auction Routes', () => {
    const mockAddress = 'GB7V7Z5K64I6U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7';
    const otherAddress = 'GD7V7Z5K64I6U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7U6I7';
    const token = generateTestToken(mockAddress);

    describe('GET /api/auctions', () => {
        it('should return a list of auctions', async () => {
            (pool.query as any).mockResolvedValue({
                rows: [
                    {
                        auction_id: 1,
                        publisher: 'GD7...',
                        impression_slot: 'top',
                        floor_price_stroops: '100',
                        status: 'Open',
                        start_time: new Date(),
                        end_time: new Date()
                    }
                ]
            });

            const response = await request(app).get('/api/auctions');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('auctions');
            expect(Array.isArray(response.body.auctions)).toBe(true);
            expect(response.body.auctions[0]).toHaveProperty('auctionId');
        });
    });

    describe('POST /api/auctions/:id/bid', () => {
        it('should submit a bid when authenticated', async () => {
            const bidData = {
                campaignId: 1,
                amountStroops: 150
            };

            (pool.query as any)
                // Auction lookup
                .mockResolvedValueOnce({
                    rows: [{ publisher: otherAddress, floor_price_stroops: '100', status: 'Open' }]
                })
                // Campaign ownership check
                .mockResolvedValueOnce({
                    rows: [{ advertiser: mockAddress }]
                })
                // Insert bid
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'bid-uuid',
                        auction_id: 1,
                        bidder: mockAddress,
                        campaign_id: bidData.campaignId,
                        amount_stroops: bidData.amountStroops
                    }]
                })
                // Update bid count
                .mockResolvedValueOnce({ rows: [] });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send(bidData);

            expect(response.status).toBe(201);
            expect(response.body.auction_id).toBe(1);
            expect(response.body.amount_stroops).toBe(150);
        });

        it('should return 401 when not authenticated', async () => {
            const response = await request(app)
                .post('/api/auctions/1/bid')
                .send({ campaignId: 1, amountStroops: 150 });

            expect(response.status).toBe(401);
        });

        it('should return 404 when auction does not exist', async () => {
            (pool.query as any).mockResolvedValueOnce({ rows: [] });

            const response = await request(app)
                .post('/api/auctions/999/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 1, amountStroops: 150 });

            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Auction not found');
        });

        it('should return 400 when auction is not open', async () => {
            (pool.query as any).mockResolvedValueOnce({
                rows: [{ publisher: otherAddress, floor_price_stroops: '100', status: 'Closed' }]
            });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 1, amountStroops: 150 });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Auction is not open for bidding');
        });

        it('should return 403 when bidding on own auction', async () => {
            (pool.query as any).mockResolvedValueOnce({
                rows: [{ publisher: mockAddress, floor_price_stroops: '100', status: 'Open' }]
            });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 1, amountStroops: 150 });

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Cannot bid on your own auction');
        });

        it('should return 400 when bid is below floor price', async () => {
            (pool.query as any).mockResolvedValueOnce({
                rows: [{ publisher: otherAddress, floor_price_stroops: '200', status: 'Open' }]
            });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 1, amountStroops: 100 });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Bid below floor price');
        });

        it('should return 404 when campaign does not exist', async () => {
            (pool.query as any)
                .mockResolvedValueOnce({
                    rows: [{ publisher: otherAddress, floor_price_stroops: '100', status: 'Open' }]
                })
                .mockResolvedValueOnce({ rows: [] });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 999, amountStroops: 150 });

            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Campaign not found');
        });

        it('should return 403 when campaign belongs to another user', async () => {
            (pool.query as any)
                .mockResolvedValueOnce({
                    rows: [{ publisher: otherAddress, floor_price_stroops: '100', status: 'Open' }]
                })
                .mockResolvedValueOnce({
                    rows: [{ advertiser: otherAddress }]
                });

            const response = await request(app)
                .post('/api/auctions/1/bid')
                .set('Authorization', `Bearer ${token}`)
                .send({ campaignId: 1, amountStroops: 150 });

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Campaign does not belong to you');
        });
    });
});
