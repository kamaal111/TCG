export interface CardImportProgress {
  stage: 'validated' | 'lock_acquisition' | 'ownership_resolution' | 'batch_preparation' | 'commit' | 'completed';
  lastCompletedStage: 'validated' | 'lock_acquired' | 'ownership_resolved' | 'batch_prepared' | 'completed';
  transactionStatus: 'pending' | 'committed' | 'rolled_back';
}
