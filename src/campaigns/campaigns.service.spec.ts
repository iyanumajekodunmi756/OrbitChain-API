import { BadRequestException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService milestone target validation', () => {
  const prisma = {
    campaign: {
      create: jest.fn(),
    },
  };

  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(prisma as any, {} as any);
  });

  const baseDto = {
    title: 'Orbit funding round',
    goalAmount: '100',
  };

  it.each([
    ['missing', undefined],
    ['zero', '0'],
    ['zero decimal', '0.0000000'],
    ['below the minimum precision', '0.00000001'],
    ['negative', '-1'],
    ['not numeric', 'abc'],
  ])('rejects a %s milestone targetAmount', async (_case, targetAmount) => {
    await expect(
      service.createCampaign('user-1', {
        ...baseDto,
        milestones: [
          {
            title: 'Prototype',
            targetAmount,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('passes a valid positive milestone targetAmount through to Prisma', async () => {
    prisma.campaign.create.mockResolvedValue({ id: 'campaign-1' });

    await service.createCampaign('user-1', {
      ...baseDto,
      milestones: [
        {
          title: 'Prototype',
          targetAmount: '0.0000001',
        },
      ],
    });

    expect(prisma.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          milestones: {
            create: [
              expect.objectContaining({
                targetAmount: '0.0000001',
              }),
            ],
          },
        }),
      }),
    );
  });
});
