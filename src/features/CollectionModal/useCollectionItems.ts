import type { CollectionWorkItem } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { workService } from '@/services/work';

/**
 * The images a collection viewer shows: the ones the caller passed, else those of
 * the Work's latest version (readable by its owner only).
 */
export const useCollectionItems = ({
  items,
  workId,
}: {
  items?: CollectionWorkItem[];
  workId?: string;
}) => {
  const { data, error, isLoading, mutate } = useClientDataSWR(
    items || !workId ? null : ['collection-work-images', workId],
    async () => {
      // Versions come newest first.
      const [latest] = await workService.listVersions(workId!);
      return latest?.metadata?.collection?.items ?? [];
    },
  );

  return {
    error: items ? undefined : error,
    images: items ?? data,
    isLoading: !items && isLoading,
    retry: () => {
      void mutate();
    },
  };
};
