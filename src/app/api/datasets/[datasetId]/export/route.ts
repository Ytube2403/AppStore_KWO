import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'

// Prevent formula injection in CSV/Excel exports
function sanitizeValue(val: any) {
    if (typeof val === 'string' && val.trim().length > 0) {
        if (/^[=+\-@\t\r\n]/.test(val)) {
            return "'" + val
        }
    }
    return val
}

export async function POST(req: Request, { params }: { params: Promise<{ datasetId: string }> }) {
    try {
        const { datasetId } = await params
        const { format, selectedData, filteredData, datasetName, presetMetadata } = await req.json()

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Check if dataset is accessible via user's workspace memberships
        const { data: dataset, error } = await supabase
            .from('datasets')
            .select('id, name')
            .eq('id', datasetId)
            .single()

        if (error || !dataset) {
            return NextResponse.json({ error: 'Dataset not found or access denied' }, { status: 404 })
        }

        const sanitizeArray = (arr: any[]) => arr.map(row => {
            const newRow: any = {}
            for (const key in row) {
                newRow[key] = sanitizeValue(row[key])
            }
            return newRow
        })

        const sanitizedSelected = sanitizeArray(selectedData || [])
        const sanitizedFiltered = sanitizeArray(filteredData || [])

        if (format === 'csv') {
            const targetData = sanitizedSelected.length > 0 ? sanitizedSelected : sanitizedFiltered

            if (targetData.length === 0) {
                return NextResponse.json({ error: 'No data to export' }, { status: 400 })
            }

            const csv = Papa.unparse(targetData)

            return new NextResponse(csv, {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="ASO_Export_${datasetName}_${new Date().toISOString().split('T')[0]}.csv"`
                }
            })
        } else if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook()

            // Sheet 1: Selected
            if (sanitizedSelected.length > 0) {
                const sheetSelected = workbook.addWorksheet('Selected Keywords')
                sheetSelected.columns = Object.keys(sanitizedSelected[0]).map(key => ({ header: key, key }))
                sheetSelected.addRows(sanitizedSelected)

                // Style header
                sheetSelected.getRow(1).font = { bold: true }
            }

            // Sheet 2: Filtered
            if (sanitizedFiltered.length > 0) {
                const sheetFiltered = workbook.addWorksheet('Filtered Keywords')
                sheetFiltered.columns = Object.keys(sanitizedFiltered[0]).map(key => ({ header: key, key }))
                sheetFiltered.addRows(sanitizedFiltered)

                // Style header
                sheetFiltered.getRow(1).font = { bold: true }
            }

            // Sheet 3: Preset Metadata
            if (presetMetadata) {
                const sheetMeta = workbook.addWorksheet('Preset Metadata')
                sheetMeta.columns = [
                    { header: 'Setting', key: 'setting', width: 25 },
                    { header: 'Value', key: 'value', width: 50 },
                ]
                Object.entries(presetMetadata).forEach(([key, value]) => {
                    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
                    sheetMeta.addRow({ setting: key, value: strValue })
                })
                sheetMeta.getRow(1).font = { bold: true }
            }

            // Ensure at least one sheet exists
            if (workbook.worksheets.length === 0) {
                workbook.addWorksheet('No Data Exported')
            }

            const buffer = await workbook.xlsx.writeBuffer()

            return new NextResponse(buffer, {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="ASO_Export_${datasetName}_${new Date().toISOString().split('T')[0]}.xlsx"`
                }
            })
        }

        return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error generating export' }, { status: 500 })
    }
}
