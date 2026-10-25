import assert from 'node:assert/strict';
import { createMisTestClient, loadMisConfig } from './mis-package.mjs';
import { cleanupProductionTest } from './cleanup-production-test.mjs';

const cfg = loadMisConfig();
const { client, user } = await createMisTestClient(cfg);
const companyId = cfg.SUPABASE_COMPANY_ID;
const tag = crypto.randomUUID();
const fixture = { companyId, spkIds: [], masterIds: [] };
let controlId;
const insert = async (table, values) => {
  const { data } = await client.from(table).insert({ company_id: companyId, ...values }).select('*').single().throwOnError();
  return data;
};
const document = (kind, source) => insert('business_document', {
  document_kind: kind, document_number: `CLEAN-${crypto.randomUUID()}`,
  transaction_date: new Date().toISOString().slice(0, 10), source_document_id: source,
});
try {
  controlId = (await insert('master_record', { record_kind: 'material', name: `Cleanup control ${tag}` })).id;
  fixture.productId = (await insert('master_record', { record_kind: 'product', name: `Cleanup product ${tag}`, sku: `CLEAN-${tag.toUpperCase()}` })).id;
  fixture.masterIds.push(fixture.productId);
  fixture.materialId = (await insert('master_record', { record_kind: 'material', name: `Cleanup material ${tag}` })).id;
  fixture.masterIds.push(fixture.materialId);
  const employee = await insert('master_record', { record_kind: 'employee', name: `Cleanup operator ${tag}` });
  fixture.masterIds.push(employee.id);
  const profile = await insert('production_operator_profile', { employee_id: employee.id, user_id: user.id, operator_role: 'operator_potong' });
  fixture.productionOrderId = (await document('production_order')).id;
  const cutting = await document('work_order', fixture.productionOrderId);
  fixture.spkIds.push(cutting.id);
  const printing = await document('work_order', fixture.productionOrderId);
  fixture.spkIds.push(printing.id);
  for (const [doc, stage] of [[cutting, 'cutting'], [printing, 'printing']]) {
    await insert('production_work_order', { document_id: doc.id, production_order_id: fixture.productionOrderId, stage, operator_profile_id: profile.id });
  }
  const actualCutting = await document('cutting_output', cutting.id);
  const actualPrinting = await document('printing_output', printing.id);
  fixture.sourceDocumentId = (await document('purchase_material')).id;
  const sourceLine = await insert('business_document_line', { document_id: fixture.sourceDocumentId, line_number: 1, item_id: fixture.materialId, quantity: 1, unit_price: 1, subtotal: 1, total_amount: 1 });
  fixture.rollId = (await insert('production_material_unit', {
    material_id: fixture.materialId, source_document_id: fixture.sourceDocumentId, source_line_id: sourceLine.id,
    receipt_cycle: 1, physical_code: `CLEAN-${tag}`, packaging_unit_code: 'roll', stock_unit_code: 'KG', initial_base_quantity: 1,
    status: 'consumed', consumed_by_document_id: actualCutting.id, consumed_at: new Date().toISOString(),
  })).id;
  const lot = await insert('production_cutting_lot', {
    production_order_id: fixture.productionOrderId, cutting_work_order_id: cutting.id,
    source_actual_document_id: actualCutting.id, physical_material_unit_id: fixture.rollId, lot_code: `CLEAN-${tag}`,
  });
  const bundle = await insert('production_bundle', {
    production_order_id: fixture.productionOrderId, cutting_lot_id: lot.id, product_id: fixture.productId,
    bundle_code: `CLEAN-${tag}`, initial_quantity: 1, active_quantity: 1, last_actual_work_order_id: printing.id,
  });
  await insert('production_work_order_bundle', { work_order_id: printing.id, bundle_id: bundle.id });
  await insert('production_bundle_reservation', { work_order_id: printing.id, bundle_id: bundle.id });
  await insert('production_bundle_stage_result', {
    production_order_id: fixture.productionOrderId, work_order_id: printing.id, actual_document_id: actualPrinting.id,
    bundle_id: bundle.id, stage: 'printing', worked_quantity: 1, success_quantity: 1, repair_quantity: 0, final_rejected_quantity: 0,
  });
  await insert('production_repair_case', {
    production_order_id: fixture.productionOrderId, source_work_order_id: printing.id, bundle_id: bundle.id,
    found_at_stage: 'printing', repair_work_kind: 'printing', quantity: 1, issue_reason: 'Cleanup fixture',
  });
  const { error } = await client.from('production_bundle').delete().eq('company_id', companyId).eq('id', bundle.id);
  assert.equal(error?.code, '23503', 'Urutan lama harus gagal karena foreign key nyata.');
  await cleanupProductionTest(client, fixture);
  for (const [table, field, values] of [
    ['business_document', 'id', [fixture.productionOrderId, ...fixture.spkIds, actualCutting.id, actualPrinting.id, fixture.sourceDocumentId]],
    ['production_bundle', 'id', [bundle.id]], ['production_work_order_bundle', 'bundle_id', [bundle.id]],
    ['production_bundle_stage_result', 'bundle_id', [bundle.id]], ['production_bundle_reservation', 'bundle_id', [bundle.id]],
    ['master_record', 'id', fixture.masterIds], ['production_material_unit', 'id', [fixture.rollId]],
  ]) {
    const { data } = await client.from(table).select('*').eq('company_id', companyId).in(field, values).throwOnError();
    assert.equal(data.length, 0, `Fixture ${table} harus bersih.`);
  }
  const { data: control } = await client.from('master_record').select('id').eq('company_id', companyId).eq('id', controlId).single().throwOnError();
  assert.equal(control.id, controlId, 'Cleanup tidak boleh menghapus record di luar run.');
  console.log('PASS cleanup dengan foreign key nyata; child dan SPK dibersihkan sebelum parent, record kontrol tetap ada.');
} finally {
  await cleanupProductionTest(client, fixture);
  if (controlId) await client.from('master_record').delete().eq('company_id', companyId).eq('id', controlId).throwOnError();
  await client.auth.signOut({ scope: 'local' });
}
