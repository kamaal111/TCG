//
//  ModuleConfig.swift
//  TCGDesignSystem
//
//  Created by Kamaal M Farah on 9/11/26.
//

enum ModuleConfig {
    static let cardImageURLCacheMemoryCapacity = 32 * oneMegabyte
    static let cardImageURLCacheDiskCapacity = 256 * oneMegabyte

    private static let oneMegabyte = 1_024 * 1_024
}
