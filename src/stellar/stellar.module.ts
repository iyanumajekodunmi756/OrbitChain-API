import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { StellarEventService } from './stellar-event.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { StellarTransactionsService } from './stellar-transactions.service';

/** Module providing Stellar Horizon, Soroban, and transaction services */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [SorobanService, StellarEventService, StellarTransactionsService],
  exports: [SorobanService, StellarEventService, StellarTransactionsService],
})
export class StellarModule {}
