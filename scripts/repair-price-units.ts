import { prisma } from '../src/lib/prisma';
import { normalizeFuelPriceValue, type PriceNormalizationReason } from '../src/lib/price-normalization';

type UpdateCandidate = {
  table: 'CurrentPrice' | 'PriceHistory';
  stationId: string;
  fuelType: string;
  timestamp: Date;
  oldPrice: number;
  newPrice: number;
  reason: Exclude<PriceNormalizationReason, 'already-pence'>;
};

const UPDATE_BATCH_SIZE = 20;

function shouldApplyChanges() {
  return process.argv.includes('--apply');
}

function summarizeCandidates(candidates: UpdateCandidate[]) {
  const summary = {
    total: candidates.length,
    currentPrice: 0,
    priceHistory: 0,
    convertedFromPounds: 0,
    fixedDecimal: 0,
  };

  for (const candidate of candidates) {
    if (candidate.table === 'CurrentPrice') {
      summary.currentPrice += 1;
    } else {
      summary.priceHistory += 1;
    }

    if (candidate.reason === 'converted-from-pounds') {
      summary.convertedFromPounds += 1;
    } else if (candidate.reason === 'fixed-decimal') {
      summary.fixedDecimal += 1;
    }
  }

  return summary;
}

async function collectCurrentPriceUpdates() {
  const rows = await prisma.currentPrice.findMany({
    select: {
      stationId: true,
      fuelType: true,
      timestamp: true,
      price: true,
    },
  });

  return rows.flatMap<UpdateCandidate>((row) => {
    const normalized = normalizeFuelPriceValue(row.price);

    if (!normalized || normalized.reason === 'already-pence' || normalized.normalizedPrice === row.price) {
      return [];
    }

    return [
      {
        table: 'CurrentPrice',
        stationId: row.stationId,
        fuelType: row.fuelType,
        timestamp: row.timestamp,
        oldPrice: row.price,
        newPrice: normalized.normalizedPrice,
        reason: normalized.reason,
      },
    ];
  });
}

async function collectPriceHistoryUpdates() {
  const rows = await prisma.priceHistory.findMany({
    select: {
      stationId: true,
      fuelType: true,
      timestamp: true,
      price: true,
    },
  });

  return rows.flatMap<UpdateCandidate>((row) => {
    const normalized = normalizeFuelPriceValue(row.price);

    if (!normalized || normalized.reason === 'already-pence' || normalized.normalizedPrice === row.price) {
      return [];
    }

    return [
      {
        table: 'PriceHistory',
        stationId: row.stationId,
        fuelType: row.fuelType,
        timestamp: row.timestamp,
        oldPrice: row.price,
        newPrice: normalized.normalizedPrice,
        reason: normalized.reason,
      },
    ];
  });
}

async function applyCurrentPriceUpdates(candidates: UpdateCandidate[]) {
  for (let index = 0; index < candidates.length; index += UPDATE_BATCH_SIZE) {
    const batch = candidates.slice(index, index + UPDATE_BATCH_SIZE);

    await prisma.$transaction(
      batch.map((candidate) =>
        prisma.currentPrice.update({
          where: {
            stationId_fuelType: {
              stationId: candidate.stationId,
              fuelType: candidate.fuelType,
            },
          },
          data: {
            price: candidate.newPrice,
          },
        }),
      ),
    );
  }
}

async function applyPriceHistoryUpdates(candidates: UpdateCandidate[]) {
  for (let index = 0; index < candidates.length; index += UPDATE_BATCH_SIZE) {
    const batch = candidates.slice(index, index + UPDATE_BATCH_SIZE);

    await prisma.$transaction(
      batch.map((candidate) =>
        prisma.priceHistory.update({
          where: {
            stationId_fuelType_timestamp: {
              stationId: candidate.stationId,
              fuelType: candidate.fuelType,
              timestamp: candidate.timestamp,
            },
          },
          data: {
            price: candidate.newPrice,
          },
        }),
      ),
    );
  }
}

async function main() {
  const applyChanges = shouldApplyChanges();
  const [currentUpdates, historyUpdates] = await Promise.all([
    collectCurrentPriceUpdates(),
    collectPriceHistoryUpdates(),
  ]);
  const candidates = [...currentUpdates, ...historyUpdates];
  const summary = summarizeCandidates(candidates);

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? 'apply' : 'dry-run',
        summary,
        sample: candidates.slice(0, 10),
      },
      null,
      2,
    ),
  );

  if (!applyChanges || candidates.length === 0) {
    if (!applyChanges) {
      console.log('Dry run only. Re-run with --apply to persist these repairs.');
    }
    return;
  }

  await applyCurrentPriceUpdates(currentUpdates);
  await applyPriceHistoryUpdates(historyUpdates);

  console.log(`Applied ${candidates.length} price repairs in place.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
