/**
 * Canonical board schemas. These titles are what `scripts/importToMonday.ts`
 * creates, and what the reader maps against (by column *title*, so the agent
 * keeps working even if Monday reassigns internal column ids).
 */

export type MondayColumnType = 'text' | 'numbers' | 'date';

export interface ColumnDef {
  key: string;
  title: string;
  type: MondayColumnType;
  src: string;
}

export interface BoardSchema {
  key: string;
  nameSourceHeader: string;
  headerTokens: string[];
  columns: ColumnDef[];
}

export const DEALS_BOARD: BoardSchema = {
  key: 'deals',
  nameSourceHeader: 'Deal Name',
  headerTokens: [
    'Deal Name',
    'Owner code',
    'Client Code',
    'Deal Status',
    'Deal Stage',
    'Closure Probability',
    'Sector/service',
    'Created Date',
  ],
  columns: [
    { key: 'ownerCode', title: 'Owner Code', type: 'text', src: 'Owner code' },
    { key: 'clientCode', title: 'Client Code', type: 'text', src: 'Client Code' },
    { key: 'dealStatus', title: 'Deal Status', type: 'text', src: 'Deal Status' },
    { key: 'closeDateActual', title: 'Close Date (Actual)', type: 'date', src: 'Close Date (A)' },
    {
      key: 'closureProbability',
      title: 'Closure Probability',
      type: 'text',
      src: 'Closure Probability',
    },
    { key: 'dealValue', title: 'Masked Deal Value', type: 'numbers', src: 'Masked Deal value' },
    {
      key: 'tentativeCloseDate',
      title: 'Tentative Close Date',
      type: 'date',
      src: 'Tentative Close Date',
    },
    { key: 'dealStage', title: 'Deal Stage', type: 'text', src: 'Deal Stage' },
    { key: 'productDeal', title: 'Product Deal', type: 'text', src: 'Product deal' },
    { key: 'sector', title: 'Sector / Service', type: 'text', src: 'Sector/service' },
    { key: 'createdDate', title: 'Created Date', type: 'date', src: 'Created Date' },
  ],
};

export const WORK_ORDERS_BOARD: BoardSchema = {
  key: 'workOrders',
  nameSourceHeader: 'Deal name masked',
  headerTokens: [
    'Deal name masked',
    'Customer Name Code',
    'Serial #',
    'Nature of Work',
    'Execution Status',
    'Sector',
    'Type of Work',
    'Billing Status',
  ],
  columns: [
    { key: 'customerCode', title: 'Customer Name Code', type: 'text', src: 'Customer Name Code' },
    { key: 'serial', title: 'Serial #', type: 'text', src: 'Serial #' },
    { key: 'natureOfWork', title: 'Nature of Work', type: 'text', src: 'Nature of Work' },
    {
      key: 'lastExecutedMonth',
      title: 'Last Executed Month',
      type: 'text',
      src: 'Last executed month of recurring project',
    },
    { key: 'executionStatus', title: 'Execution Status', type: 'text', src: 'Execution Status' },
    {
      key: 'dataDeliveryDate',
      title: 'Data Delivery Date',
      type: 'date',
      src: 'Data Delivery Date',
    },
    { key: 'poDate', title: 'Date of PO/LOI', type: 'date', src: 'Date of PO/LOI' },
    { key: 'documentType', title: 'Document Type', type: 'text', src: 'Document Type' },
    {
      key: 'probableStartDate',
      title: 'Probable Start Date',
      type: 'date',
      src: 'Probable Start Date',
    },
    { key: 'probableEndDate', title: 'Probable End Date', type: 'date', src: 'Probable End Date' },
    {
      key: 'bdKamCode',
      title: 'BD/KAM Personnel Code',
      type: 'text',
      src: 'BD/KAM Personnel code',
    },
    { key: 'sector', title: 'Sector', type: 'text', src: 'Sector' },
    { key: 'typeOfWork', title: 'Type of Work', type: 'text', src: 'Type of Work' },
    {
      key: 'skylarkPlatform',
      title: 'Skylark Platform in Deliverables',
      type: 'text',
      src: 'Is any Skylark software platform part of the client deliverables in this deal?',
    },
    { key: 'lastInvoiceDate', title: 'Last Invoice Date', type: 'date', src: 'Last invoice date' },
    { key: 'latestInvoiceNo', title: 'Latest Invoice No', type: 'text', src: 'latest invoice no.' },
    {
      key: 'amountExGst',
      title: 'Amount Excl GST (Masked)',
      type: 'numbers',
      src: 'Amount in Rupees (Excl of GST) (Masked)',
    },
    {
      key: 'amountInGst',
      title: 'Amount Incl GST (Masked)',
      type: 'numbers',
      src: 'Amount in Rupees (Incl of GST) (Masked)',
    },
    {
      key: 'billedExGst',
      title: 'Billed Value Excl GST (Masked)',
      type: 'numbers',
      src: 'Billed Value in Rupees (Excl of GST.) (Masked)',
    },
    {
      key: 'billedInGst',
      title: 'Billed Value Incl GST (Masked)',
      type: 'numbers',
      src: 'Billed Value in Rupees (Incl of GST.) (Masked)',
    },
    {
      key: 'collectedInGst',
      title: 'Collected Amount Incl GST (Masked)',
      type: 'numbers',
      src: 'Collected Amount in Rupees (Incl of GST.) (Masked)',
    },
    {
      key: 'toBeBilledExGst',
      title: 'Amount To Be Billed Excl GST (Masked)',
      type: 'numbers',
      src: 'Amount to be billed in Rs. (Exl. of GST) (Masked)',
    },
    {
      key: 'toBeBilledInGst',
      title: 'Amount To Be Billed Incl GST (Masked)',
      type: 'numbers',
      src: 'Amount to be billed in Rs. (Incl. of GST) (Masked)',
    },
    {
      key: 'receivable',
      title: 'Amount Receivable (Masked)',
      type: 'numbers',
      src: 'Amount Receivable (Masked)',
    },
    { key: 'arPriority', title: 'AR Priority Account', type: 'text', src: 'AR Priority account' },
    { key: 'qtyByOps', title: 'Quantity by Ops', type: 'text', src: 'Quantity by Ops' },
    { key: 'qtyPerPo', title: 'Quantities as per PO', type: 'text', src: 'Quantities as per PO' },
    {
      key: 'qtyBilled',
      title: 'Quantity Billed (Till Date)',
      type: 'text',
      src: 'Quantity billed (till date)',
    },
    { key: 'qtyBalance', title: 'Balance in Quantity', type: 'text', src: 'Balance in quantity' },
    { key: 'invoiceStatus', title: 'Invoice Status', type: 'text', src: 'Invoice Status' },
    {
      key: 'expectedBillingMonth',
      title: 'Expected Billing Month',
      type: 'text',
      src: 'Expected Billing Month',
    },
    {
      key: 'actualBillingMonth',
      title: 'Actual Billing Month',
      type: 'text',
      src: 'Actual Billing Month',
    },
    {
      key: 'actualCollectionMonth',
      title: 'Actual Collection Month',
      type: 'text',
      src: 'Actual Collection Month',
    },
    { key: 'woStatusBilled', title: 'WO Status (Billed)', type: 'text', src: 'WO Status (billed)' },
    { key: 'collectionStatus', title: 'Collection Status', type: 'text', src: 'Collection status' },
    { key: 'collectionDate', title: 'Collection Date', type: 'date', src: 'Collection Date' },
    { key: 'billingStatus', title: 'Billing Status', type: 'text', src: 'Billing Status' },
  ],
};

export const BOARDS = { deals: DEALS_BOARD, workOrders: WORK_ORDERS_BOARD } as const;
