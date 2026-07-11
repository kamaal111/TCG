//
//  TCGClientValidationErrorParser.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation

enum TCGClientValidationErrorParser {
    static func parseIssues(from payload: some Encodable) -> [TCGClientValidationIssue] {
        let data: Data
        do {
            data = try getEncoder().encode(payload)
        } catch {
            return []
        }

        let response = try? getDecoder().decode(ValidationErrorResponse.self, from: data)

        return response?.context?.validations
            .map { issue in
                TCGClientValidationIssue(code: issue.code, path: issue.path.map(\.value), message: issue.message)
            } ?? []
    }

    private static func getEncoder() -> JSONEncoder {
        JSONEncoder()
    }

    private static func getDecoder() -> JSONDecoder {
        JSONDecoder()
    }
}

private struct ValidationErrorResponse: Decodable {
    let context: ValidationContext?
}

private struct ValidationContext: Decodable {
    let validations: [ValidationIssue]
}

private struct ValidationIssue: Decodable {
    let code: String
    let path: [ValidationPathComponent]
    let message: String
}

private enum ValidationPathComponent: Decodable {
    case string(String)
    case number(Int)

    var value: String {
        switch self {
        case .string(let value):
            value
        case .number(let value):
            String(value)
        }
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
            return
        }

        if let numberValue = try? container.decode(Int.self) {
            self = .number(numberValue)
            return
        }

        throw DecodingError.typeMismatch(
            ValidationPathComponent.self,
            .init(
                codingPath: decoder.codingPath,
                debugDescription: "Expected a string or integer validation path component",
            ),
        )
    }
}
