// Semua identifier berasal dari fixture baru; companyId selalu berasal dari paket MIS.
export async function cleanupProductionTest(client, fixture) {
  const { companyId, productionOrderId, spkIds = [], rollId, sourceDocumentId, productId, materialId, masterIds = [] } = fixture;
  if (!companyId) throw new Error('Scope perusahaan wajib untuk cleanup.');
  const remove = (table) => client.from(table).delete().eq('company_id', companyId);

  if (productionOrderId) {
    await remove('production_repair_case').eq('production_order_id', productionOrderId).throwOnError();
    const { data: bundles } = await client.from('production_bundle').select('id')
      .eq('company_id', companyId).eq('production_order_id', productionOrderId).throwOnError();
    const bundleIds = bundles.map((bundle) => bundle.id);
    if (bundleIds.length) {
      for (const table of ['production_work_order_bundle', 'production_bundle_stage_result', 'production_bundle_reservation']) {
        await remove(table).in('bundle_id', bundleIds).throwOnError();
      }
      await remove('production_bundle').in('id', bundleIds).throwOnError();
    }
    await remove('production_printing_operator').eq('production_order_id', productionOrderId).throwOnError();
    await remove('production_cutting_lot').eq('production_order_id', productionOrderId).throwOnError();
  }
  if (productId) await remove('wage_liability').eq('item_id', productId).throwOnError();
  const itemIds = [productId, materialId].filter(Boolean);
  if (itemIds.length) await remove('inventory_movement').in('item_id', itemIds).throwOnError();
  // Roll yang telah dikonsumsi merujuk dokumen aktual, sehingga harus dihapus lebih dahulu.
  if (rollId) await remove('production_material_unit').eq('id', rollId).throwOnError();

  // SPK anak dihapus sebelum PP; dokumen aktual dihapus sebelum SPK sumbernya.
  for (const documentId of [...spkIds.filter(Boolean).reverse(), productionOrderId].filter(Boolean)) {
    await remove('production_work_order').eq('document_id', documentId).throwOnError();
    const { data: actuals } = await client.from('business_document').select('id')
      .eq('company_id', companyId).eq('source_document_id', documentId).throwOnError();
    for (const actual of actuals) {
      await remove('business_document_line').eq('document_id', actual.id).throwOnError();
      await remove('business_document').eq('id', actual.id).throwOnError();
    }
    await remove('business_document_line').eq('document_id', documentId).throwOnError();
    await remove('business_document').eq('id', documentId).throwOnError();
  }
  if (sourceDocumentId) {
    await remove('business_document_line').eq('document_id', sourceDocumentId).throwOnError();
    await remove('business_document').eq('id', sourceDocumentId).throwOnError();
  }
  if (masterIds.length) {
    await remove('production_operator_profile').in('employee_id', masterIds).throwOnError();
    if (productId) {
      await remove('wage_rate').eq('product_id', productId).throwOnError();
      await remove('production_product_routing').eq('product_id', productId).throwOnError();
      await remove('master_record').eq('record_kind', 'bom').eq('data->>productId', productId).throwOnError();
    }
    await remove('master_record').in('id', masterIds).throwOnError();
  }
}
